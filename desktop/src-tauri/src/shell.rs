use open::{that as open_with_default_application, that_detached as open_url};
use serde::Serialize;
use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant, SystemTime};
use tauri::ipc::CapabilityBuilder;
use tauri::webview::WebviewWindowBuilder;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
use tokio::sync::oneshot;
use url::Url;
use uuid::Uuid;

const PREFERRED_PORT: u16 = 5056;
const DEV_FRONTEND_URL: &str = "http://127.0.0.1:5173";
const HEALTH_PATH: &str = "/api/desktop/health";
const STARTUP_TIMEOUT: Duration = Duration::from_secs(60);
const STARTUP_RETRY_INTERVAL: Duration = Duration::from_millis(300);
const MAX_LOG_SIZE: u64 = 5 * 1024 * 1024;

#[derive(Default)]
struct ShellState {
    runtime: Mutex<RuntimeState>,
}

#[derive(Default)]
struct RuntimeState {
    backend: Option<Child>,
    session_id: Option<String>,
    app_url: Option<String>,
    data_dir: Option<PathBuf>,
    terminals: HashMap<String, TerminalSession>,
}

struct TerminalSession {
    child: Child,
    stdin: ChildStdin,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalData {
    terminal_id: String,
    data: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalExit {
    terminal_id: String,
    code: i32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OAuthCallback {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

fn log_path(data_dir: &Path) -> PathBuf {
    data_dir
        .parent()
        .unwrap_or(data_dir)
        .join("logs")
        .join("desktop-backend.log")
}

fn log_message(path: &Path, message: &str) {
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if fs::metadata(path).is_ok_and(|metadata| metadata.len() > MAX_LOG_SIZE) {
        let rotated = path.with_extension("log.1");
        let _ = fs::remove_file(&rotated);
        let _ = fs::rename(path, rotated);
    }
    let timestamp = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{timestamp} {message}");
    }
}

fn set_splash_message(app: &AppHandle, message: &str) {
    let Ok(message) = serde_json::to_string(message) else {
        return;
    };
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.eval(&format!(
            "let status = document.getElementById('status'); if (!status) {{ document.body.replaceChildren(); const main = document.createElement('main'); main.style.cssText = 'display:grid;place-items:center;height:100vh;background:#111;color:#dedede;font:14px Segoe UI,sans-serif'; status = document.createElement('p'); status.id = 'status'; main.append(status); document.body.append(main); }} status.textContent = {message};"
        ));
    }
}

fn show_error(app: &AppHandle, title: &str, message: &str) {
    app.dialog()
        .message(message)
        .title(title)
        .kind(MessageDialogKind::Error)
        .show(|_| {});
}

#[cfg(windows)]
fn hide_process_window(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    command.creation_flags(0x08000000);
}

fn has_files(path: &Path) -> bool {
    path.is_dir()
        && fs::read_dir(path)
            .ok()
            .is_some_and(|mut entries| entries.next().is_some())
}

fn copy_directory_contents(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination).map_err(|error| error.to_string())?;
    for entry in fs::read_dir(source).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        if entry.file_type().map_err(|error| error.to_string())?.is_dir() {
            copy_directory_contents(&source_path, &destination_path)?;
        } else if !destination_path.exists() {
            fs::copy(&source_path, &destination_path).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn migrate_bundled_data(data_dir: &Path) -> Result<(), String> {
    let marker = data_dir.join(".legacy-migrated");
    if marker.exists() {
        return Ok(());
    }

    let app_dir = std::env::current_exe()
        .map_err(|error| error.to_string())?
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "Cannot locate the desktop application directory.".to_owned())?;
    let mut backend_directories = vec![app_dir.join("runtime").join("backend")];
    if cfg!(debug_assertions) {
        if let Some(desktop_dir) = Path::new(env!("CARGO_MANIFEST_DIR")).ancestors().nth(1) {
            backend_directories.push(desktop_dir.join("runtime").join("backend"));
        }
    }

    let mut found_legacy_data = false;
    for backend_dir in backend_directories {
        if !backend_dir.is_dir() {
            continue;
        }
        for name in [
            "RequestLoom.db",
            "RequestLoom.db-wal",
            "RequestLoom.db-shm",
            "requestloom-data.json",
            "requestloom.settings.json",
        ] {
            let source = backend_dir.join(name);
            let destination = data_dir.join(name);
            if source.is_file() {
                found_legacy_data = true;
                if !destination.exists() {
                    fs::copy(&source, &destination).map_err(|error| error.to_string())?;
                }
            }
        }
        for name in ["uploads", "requestloom-data"] {
            let source = backend_dir.join(name);
            let destination = data_dir.join(name);
            if source.is_dir() {
                found_legacy_data = true;
                if !destination.exists() {
                    copy_directory_contents(&source, &destination)?;
                }
            }
        }
    }
    if !found_legacy_data {
        return Ok(());
    }
    fs::write(&marker, b"migrated from the bundled backend")
        .map_err(|error| error.to_string())?;
    log_message(
        &log_path(data_dir),
        "Migrated legacy data from the bundled backend directory.",
    );
    Ok(())
}

fn legacy_data_directories() -> Vec<PathBuf> {
    let root = if cfg!(windows) {
        std::env::var_os("APPDATA").map(PathBuf::from)
    } else if let Some(root) = std::env::var_os("XDG_CONFIG_HOME") {
        Some(PathBuf::from(root))
    } else {
        std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".config"))
    };
    let Some(root) = root else {
        return Vec::new();
    };

    ["test-helper-desktop", "RequestLoom-Desktop", "requestloom-desktop"]
        .into_iter()
        .map(|name| root.join(name).join("data"))
        .filter(|path| has_files(path))
        .collect()
}

async fn pick_folder(app: &AppHandle, title: &str, starting_dir: Option<&Path>) -> Option<PathBuf> {
    let (send, receive) = oneshot::channel();
    let mut dialog = app.dialog().file().set_title(title);
    if let Some(path) = starting_dir {
        dialog = dialog.set_directory(path);
    }
    dialog.pick_folder(move |path| {
        let _ = send.send(path.and_then(|selected| selected.into_path().ok()));
    });
    receive.await.ok().flatten()
}

async fn resolve_data_directory(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(path) = std::env::var_os("REQUESTLOOM_DATA_DIR") {
        let directory = PathBuf::from(path);
        fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
        return Ok(directory);
    }

    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&config_dir).map_err(|error| error.to_string())?;
    let saved_selection = config_dir.join("legacy-data-directory.txt");
    if let Ok(path) = fs::read_to_string(&saved_selection) {
        let directory = PathBuf::from(path.trim());
        if has_files(&directory) {
            return Ok(directory);
        }
    }

    let existing = legacy_data_directories();
    let selection = match existing.as_slice() {
        [] => app
            .path()
            .app_data_dir()
            .map_err(|error| error.to_string())?
            .join("data"),
        [directory] => directory.clone(),
        directories => {
            let candidates = directories
                .iter()
                .map(|path| format!("  {}", path.display()))
                .collect::<Vec<_>>()
                .join("\n");
            let root = directories.first().and_then(|path| path.parent());
            let selected = pick_folder(
                app,
                &format!(
                    "Multiple RequestLoom data folders were found. Choose the existing data folder to keep:\n{candidates}"
                ),
                root,
            )
            .await
            .ok_or_else(|| "Data folder selection was cancelled.".to_owned())?;
            if !directories.iter().any(|path| path == &selected) || !has_files(&selected) {
                return Err("Choose one of the populated RequestLoom data folders.".to_owned());
            }
            fs::write(&saved_selection, selected.to_string_lossy().as_bytes())
                .map_err(|error| error.to_string())?;
            selected
        }
    };

    fs::create_dir_all(&selection).map_err(|error| error.to_string())?;
    Ok(selection)
}

fn backend_program() -> Result<(PathBuf, Option<PathBuf>), String> {
    if cfg!(debug_assertions) {
        let directory = std::env::var_os("REQUESTLOOM_DESKTOP_BACKEND_DIR")
            .map(PathBuf::from)
            .or_else(|| {
                Path::new(env!("CARGO_MANIFEST_DIR"))
                    .ancestors()
                    .nth(2)
                    .map(|root| root.join("backend").join("bin").join("Debug").join("net10.0"))
            })
            .ok_or_else(|| "Cannot locate the Debug backend directory.".to_owned())?;
        return Ok((directory.join("RequestLoom.Api.dll"), Some(directory)));
    }

    let app_dir = std::env::current_exe()
        .map_err(|error| error.to_string())?
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "Cannot locate the desktop application directory.".to_owned())?;
    let backend_dir = app_dir.join("runtime").join("backend");
    #[cfg(windows)]
    let executable = backend_dir.join("RequestLoom.Api.exe");
    #[cfg(not(windows))]
    let executable = backend_dir.join("RequestLoom.Api");
    Ok((executable, None))
}

fn reserve_backend_url() -> Result<String, String> {
    if let Ok(configured) = std::env::var("REQUESTLOOM_APP_URL") {
        let url = Url::parse(&configured).map_err(|_| "REQUESTLOOM_APP_URL must be a valid loopback URL.".to_owned())?;
        if url.scheme() != "http"
            || !matches!(url.host_str(), Some("127.0.0.1" | "localhost"))
            || url.username() != ""
            || url.password().is_some()
            || url.path() != "/"
        {
            return Err("REQUESTLOOM_APP_URL must use an HTTP loopback address without a path or credentials.".to_owned());
        }
        return Ok(format!("http://127.0.0.1:{}", url.port_or_known_default().unwrap_or(PREFERRED_PORT)));
    }

    let preferred = TcpListener::bind(("127.0.0.1", PREFERRED_PORT));
    let port = match preferred {
        Ok(listener) => {
            drop(listener);
            PREFERRED_PORT
        }
        Err(error) if cfg!(debug_assertions) => {
            return Err(format!("Port {PREFERRED_PORT} is in use. Stop the other server before launching the desktop debug build. ({error})"));
        }
        Err(_) => {
            let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|error| error.to_string())?;
            let port = listener.local_addr().map_err(|error| error.to_string())?.port();
            drop(listener);
            port
        }
    };
    Ok(format!("http://127.0.0.1:{port}"))
}

fn read_backend_output<R: Read + Send + 'static>(reader: R, app: AppHandle, session_id: String, path: PathBuf, stream_name: &'static str) {
    thread::spawn(move || {
        for line in BufReader::new(reader).lines().map_while(Result::ok) {
            log_message(&path, &format!("[{session_id} {stream_name}] {line}"));
            let _ = app.emit("backend-log", line);
        }
    });
}

fn start_backend(app: &AppHandle, data_dir: &Path, url: &str) -> Result<String, String> {
    let (program, backend_dir) = backend_program()?;
    if !program.is_file() {
        return Err(format!("The bundled RequestLoom backend is missing: {}", program.display()));
    }

    let token = Uuid::new_v4().to_string();
    let session_id = Uuid::new_v4().to_string();
    let mut command = if let Some(directory) = backend_dir {
        let mut dotnet = Command::new("dotnet");
        dotnet.current_dir(directory).arg(&program);
        dotnet
    } else {
        let mut backend = Command::new(&program);
        if let Some(directory) = program.parent() {
            backend.current_dir(directory);
        }
        backend
    };
    #[cfg(windows)]
    hide_process_window(&mut command);

    let mut child = command
        .env("ASPNETCORE_URLS", url)
        .env("ASPNETCORE_ENVIRONMENT", if cfg!(debug_assertions) { "Development" } else { "Production" })
        .env("DOTNET_ENVIRONMENT", if cfg!(debug_assertions) { "Development" } else { "Production" })
        .env("REQUESTLOOM_DATA_DIR", data_dir)
        .env("REQUESTLOOM_PARENT_PID", std::process::id().to_string())
        .env("REQUESTLOOM_DESKTOP_SESSION", &token)
        .env("DOTNET_gcServer", "0")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Could not start the bundled backend: {error}"))?;

    let path = log_path(data_dir);
    log_message(&path, &format!("Starting backend (session {session_id}) at {url}."));
    if let Some(stdout) = child.stdout.take() {
        read_backend_output(stdout, app.clone(), session_id.clone(), path.clone(), "stdout");
    }
    if let Some(stderr) = child.stderr.take() {
        read_backend_output(stderr, app.clone(), session_id.clone(), path.clone(), "stderr");
    }

    {
        let state = app.state::<ShellState>();
        let mut runtime = state.runtime.lock().map_err(|error| error.to_string())?;
        runtime.backend = Some(child);
        runtime.session_id = Some(session_id.clone());
        runtime.app_url = Some(url.to_owned());
        runtime.data_dir = Some(data_dir.to_path_buf());
    }

    monitor_backend(app.clone(), session_id.clone(), path);
    Ok(token)
}

fn monitor_backend(app: AppHandle, session_id: String, path: PathBuf) {
    thread::spawn(move || loop {
        let exited = {
            let state = app.state::<ShellState>();
            let Ok(mut runtime) = state.runtime.lock() else {
                return;
            };
            if runtime.session_id.as_deref() != Some(&session_id) {
                return;
            }
            let Some(child) = runtime.backend.as_mut() else {
                return;
            };
            match child.try_wait() {
                Ok(Some(status)) => {
                    runtime.backend.take();
                    runtime.session_id = None;
                    Some(status.code().unwrap_or(-1))
                }
                Ok(None) => None,
                Err(error) => Some(-1_i32.saturating_sub(error.raw_os_error().unwrap_or_default())),
            }
        };

        if let Some(code) = exited {
            log_message(&path, &format!("Backend exited unexpectedly with code {code}."));
            show_error(&app, "RequestLoom backend stopped", &format!(
                "The embedded backend stopped unexpectedly (exit code {code}).\n\nSee {} for details.",
                path.display()
            ));
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.close();
            }
            return;
        }
        thread::sleep(STARTUP_RETRY_INTERVAL);
    });
}

fn stop_backend(app: &AppHandle) {
    let child = app
        .state::<ShellState>()
        .runtime
        .lock()
        .ok()
        .and_then(|mut runtime| {
            runtime.session_id = None;
            runtime.backend.take()
        });
    if let Some(mut child) = child {
        let _ = child.kill();
        let _ = child.wait();
    }
}

fn probe_backend(url: &str, token: &str) -> Result<bool, String> {
    let address = url.strip_prefix("http://").ok_or("Backend URL must use HTTP.")?;
    let mut stream = TcpStream::connect(address).map_err(|error| error.to_string())?;
    stream
        .set_read_timeout(Some(Duration::from_secs(1)))
        .map_err(|error| error.to_string())?;
    write!(
        stream,
        "GET {HEALTH_PATH} HTTP/1.1\r\nHost: {address}\r\nX-RequestLoom-Session: {token}\r\nConnection: close\r\n\r\n"
    )
    .map_err(|error| error.to_string())?;
    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .map_err(|error| error.to_string())?;
    let status_ok = response
        .lines()
        .next()
        .is_some_and(|status| status.contains(" 200 "));
    let matching_session = response.contains(&format!("\"sessionId\":\"{token}\""));
    Ok(status_ok && matching_session)
}

fn wait_for_backend(app: &AppHandle, url: &str, token: &str) -> Result<(), String> {
    let started = Instant::now();
    while started.elapsed() < STARTUP_TIMEOUT {
        let exited = app
            .state::<ShellState>()
            .runtime
            .lock()
            .ok()
            .and_then(|mut runtime| runtime.backend.as_mut().map(Child::try_wait))
            .transpose()
            .map_err(|error| error.to_string())?
            .flatten();
        if let Some(status) = exited {
            return Err(format!("Backend exited during startup with code {:?}.", status.code()));
        }
        if probe_backend(url, token).unwrap_or(false) {
            return Ok(());
        }
        thread::sleep(STARTUP_RETRY_INTERVAL);
    }
    Err(format!("The embedded backend did not become ready within {} seconds.", STARTUP_TIMEOUT.as_secs()))
}

async fn launch_application(app: AppHandle) {
    set_splash_message(&app, "Preparing application data…");
    let data_dir = match resolve_data_directory(&app).await {
        Ok(path) => path,
        Err(error) => {
            show_error(&app, "RequestLoom data directory", &error);
            set_splash_message(&app, &error);
            return;
        }
    };
    if let Err(error) = migrate_bundled_data(&data_dir) {
        show_error(&app, "RequestLoom data migration", &error);
        set_splash_message(&app, &error);
        return;
    }

    let url = match reserve_backend_url() {
        Ok(url) => url,
        Err(error) => {
            show_error(&app, "RequestLoom could not start", &error);
            set_splash_message(&app, &error);
            return;
        }
    };
    if !cfg!(debug_assertions) {
        if let Err(error) = app.add_capability(native_capability(format!("{url}/*"))) {
            show_error(&app, "RequestLoom native permissions", &error.to_string());
            set_splash_message(&app, "Could not initialize desktop permissions.");
            return;
        }
    }

    set_splash_message(&app, "Starting the RequestLoom backend…");
    let token = match start_backend(&app, &data_dir, &url) {
        Ok(token) => token,
        Err(error) => {
            show_error(&app, "RequestLoom could not start", &error);
            set_splash_message(&app, &error);
            return;
        }
    };

    let app_for_startup = app.clone();
    let url_for_startup = url.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        wait_for_backend(&app_for_startup, &url_for_startup, &token)
    })
    .await;
    let error = match result {
        Ok(Ok(())) => {
            if let Some(window) = app.get_webview_window("main") {
                let frontend_url = if cfg!(debug_assertions) {
                    DEV_FRONTEND_URL
                } else {
                    &url
                };
                let _ = window.navigate(frontend_url.parse().unwrap());
            }
            return;
        }
        Ok(Err(error)) => error,
        Err(error) => format!("Backend startup worker failed: {error}"),
    };
    stop_backend(&app);
    show_error(&app, "RequestLoom could not start", &format!(
        "{error}\n\nSee {} for details.",
        log_path(&data_dir).display()
    ));
    set_splash_message(&app, &error);
}

fn restore_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn is_main_navigation_allowed(app: &AppHandle, url: &Url) -> bool {
    if matches!(url.scheme(), "tauri" | "asset") || url.host_str() == Some("tauri.localhost") {
        return true;
    }
    if cfg!(debug_assertions)
        && matches!(url.host_str(), Some("localhost" | "127.0.0.1"))
        && url.port() == Some(5173)
    {
        return true;
    }
    app.state::<ShellState>()
        .runtime
        .lock()
        .ok()
        .and_then(|runtime| runtime.app_url.clone())
        .and_then(|current| Url::parse(&current).ok())
        .is_some_and(|current| {
            url.scheme() == current.scheme()
                && url.host_str() == current.host_str()
                && url.port_or_known_default() == current.port_or_known_default()
        })
}

fn focus_events(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let maximized = window.is_maximized().unwrap_or(false);
        let _ = app.emit_to("main", "window-maximized", maximized);
    }
}

fn native_capability(remote_url: String) -> CapabilityBuilder {
    let mut capability = CapabilityBuilder::new("requestloom-native")
        .local(false)
        .remote(remote_url)
        .window("main")
        .permission("core:default")
        .permission("core:event:allow-listen")
        .permission("core:event:allow-unlisten")
        .permission("core:window:allow-start-dragging")
        .permission("core:window:allow-minimize")
        .permission("core:window:allow-toggle-maximize")
        .permission("core:window:allow-close")
        .permission("core:window:allow-is-maximized");
    for command in [
        "select_directory",
        "reveal_path",
        "save_file",
        "write_clipboard",
        "open_oauth_window",
        "start_terminal",
        "write_terminal",
        "kill_terminal",
        "restart_backend",
    ] {
        capability = capability.permission(format!("allow-{}", command.replace('_', "-")));
    }
    capability
}

#[tauri::command]
async fn select_directory(app: AppHandle) -> Option<String> {
    let (send, receive) = oneshot::channel();
    app.dialog()
        .file()
        .set_title("Choose collection folder")
        .pick_folder(move |path| {
            let _ = send.send(path.and_then(|selected| selected.into_path().ok()));
        });
    receive
        .await
        .ok()
        .flatten()
        .map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command]
fn reveal_path(target_path: String) -> bool {
    let path = PathBuf::from(target_path);
    if !path.exists() {
        return false;
    }
    let target = if path.is_dir() {
        path.clone()
    } else {
        path.parent().unwrap_or(&path).to_path_buf()
    };
    open_with_default_application(target).is_ok()
}

#[tauri::command]
async fn save_file(app: AppHandle, filename: String, contents: String, mime_type: String) -> Result<bool, String> {
    let (send, receive) = oneshot::channel();
    let extension = Path::new(&filename)
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or("txt")
        .to_owned();
    app.dialog()
        .file()
        .set_title(format!("Save file ({mime_type})"))
        .set_file_name(&filename)
        .add_filter("Export", &[&extension])
        .save_file(move |path| {
            let _ = send.send(path.and_then(|selected| selected.into_path().ok()));
        });
    let Some(path) = receive.await.map_err(|error| error.to_string())? else {
        return Ok(false);
    };
    fs::write(path, contents.as_bytes()).map_err(|error| error.to_string())?;
    Ok(true)
}

#[tauri::command]
fn write_clipboard(app: AppHandle, value: String) -> Result<(), String> {
    app.clipboard().write_text(value).map_err(|error| error.to_string())
}

#[tauri::command]
async fn open_oauth_window(app: AppHandle, url: String, redirect_uri: String) -> Result<bool, String> {
    let authorization = Url::parse(&url).map_err(|error| error.to_string())?;
    let callback = Url::parse(&redirect_uri).map_err(|error| error.to_string())?;
    if !matches!(authorization.scheme(), "https" | "http")
        || !matches!(callback.scheme(), "https" | "http")
        || authorization.host_str().is_none()
        || callback.host_str().is_none()
        || authorization.username() != ""
        || authorization.password().is_some()
    {
        return Err("OAuth URLs must use a valid HTTP or HTTPS address.".to_owned());
    }
    let callback_origin = (callback.scheme().to_owned(), callback.host_str().unwrap_or_default().to_owned(), callback.port_or_known_default());
    let callback_path = callback.path().to_owned();
    let app_for_callback = app.clone();
    let url = WebviewUrl::External(authorization);
    let label = format!("oauth-{}", Uuid::new_v4().simple());
    let callback_window = label.clone();

    WebviewWindowBuilder::new(&app, label, url)
        .title("Sign in to RequestLoom")
        .inner_size(620.0, 760.0)
        .min_inner_size(420.0, 520.0)
        .on_navigation(move |navigation| {
            if navigation.scheme() == callback_origin.0
                && navigation.host_str() == Some(callback_origin.1.as_str())
                && navigation.port_or_known_default() == callback_origin.2
                && navigation.path() == callback_path
            {
                let query = navigation.query_pairs().collect::<HashMap<_, _>>();
                let fragment = navigation
                    .fragment()
                    .map(|value| url::form_urlencoded::parse(value.as_bytes()).collect::<HashMap<_, _>>())
                    .unwrap_or_default();
                let find = |key: &str| {
                    query
                        .get(key)
                        .or_else(|| fragment.get(key))
                        .map(|value| value.to_string())
                };
                let payload = OAuthCallback {
                    code: find("code"),
                    state: find("state"),
                    error: find("error"),
                    error_description: find("error_description"),
                };
                let _ = app_for_callback.emit_to("main", "oauth-callback", payload);
                if let Some(window) = app_for_callback.get_webview_window(&callback_window) {
                    let _ = window.close();
                }
                return false;
            }
            true
        })
        .on_new_window(|url, _| {
            if matches!(url.scheme(), "http" | "https" | "mailto") {
                let _ = open_url(url.as_str());
            }
            tauri::webview::NewWindowResponse::Deny
        })
        .build()
        .map(|_| true)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn start_terminal(app: AppHandle, cwd: Option<String>) -> Result<String, String> {
    let mut requested = cwd.map(PathBuf::from).filter(|path| path.exists());
    if requested.as_ref().is_some_and(|path| path.is_file()) {
        requested = requested.and_then(|path| path.parent().map(Path::to_path_buf));
    }
    let app_dir = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf));
    let workdir = requested.or(app_dir).ok_or("Unable to choose a terminal working directory.")?;

    #[cfg(windows)]
    let mut command = {
        let system_root = std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into());
        let powershell = PathBuf::from(system_root)
            .join("System32")
            .join("WindowsPowerShell")
            .join("v1.0")
            .join("powershell.exe");
        let mut command = Command::new(powershell);
        command.args(["-NoLogo", "-NoProfile"]);
        command
    };
    #[cfg(not(windows))]
    let mut command = {
        let shell = std::env::var_os("SHELL").unwrap_or_else(|| "/bin/sh".into());
        Command::new(shell)
    };
    #[cfg(windows)]
    hide_process_window(&mut command);

    let mut child = command
        .current_dir(workdir)
        .env("TERM", std::env::var("TERM").unwrap_or_else(|_| "xterm-256color".to_owned()))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Unable to start the integrated terminal: {error}"))?;

    let id = Uuid::new_v4().simple().to_string();
    let stdin = child.stdin.take().ok_or("Unable to connect to the integrated terminal.")?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    app.state::<ShellState>()
        .runtime
        .lock()
        .map_err(|error| error.to_string())?
        .terminals
        .insert(id.clone(), TerminalSession { child, stdin });

    for reader in [stdout.map(|reader| Box::new(reader) as Box<dyn Read + Send>), stderr.map(|reader| Box::new(reader) as Box<dyn Read + Send>)]
        .into_iter()
        .flatten()
    {
        let app = app.clone();
        let terminal_id = id.clone();
        thread::spawn(move || {
            let mut reader = BufReader::new(reader);
            let mut bytes = Vec::new();
            loop {
                bytes.clear();
                match reader.read_until(b'\n', &mut bytes) {
                    Ok(0) | Err(_) => break,
                    Ok(_) => {
                        let data = String::from_utf8_lossy(&bytes).into_owned();
                        let _ = app.emit("terminal-data", TerminalData {
                            terminal_id: terminal_id.clone(),
                            data,
                        });
                    }
                }
            }
        });
    }

    let app_for_exit = app.clone();
    let terminal_id = id.clone();
    thread::spawn(move || loop {
        let exit_code = {
            let state = app_for_exit.state::<ShellState>();
            let Ok(mut runtime) = state.runtime.lock() else {
                return;
            };
            let Some(session) = runtime.terminals.get_mut(&terminal_id) else {
                return;
            };
            match session.child.try_wait() {
                Ok(Some(status)) => {
                    runtime.terminals.remove(&terminal_id);
                    Some(status.code().unwrap_or(-1))
                }
                Ok(None) => None,
                Err(_) => {
                    runtime.terminals.remove(&terminal_id);
                    Some(-1)
                }
            }
        };
        if let Some(code) = exit_code {
            let _ = app_for_exit.emit("terminal-exit", TerminalExit {
                terminal_id,
                code,
            });
            return;
        }
        thread::sleep(Duration::from_millis(120));
    });
    Ok(id)
}

#[tauri::command]
fn write_terminal(app: AppHandle, terminal_id: String, input: String) -> Result<(), String> {
    let state = app.state::<ShellState>();
    let mut runtime = state.runtime.lock().map_err(|error| error.to_string())?;
    let Some(session) = runtime.terminals.get_mut(&terminal_id) else {
        return Ok(());
    };
    #[cfg(windows)]
    let input = input.replace('\u{7f}', "\u{8}");
    session.stdin.write_all(input.as_bytes()).map_err(|error| error.to_string())
}

#[tauri::command]
fn kill_terminal(app: AppHandle, terminal_id: String) -> bool {
    let child = app
        .state::<ShellState>()
        .runtime
        .lock()
        .ok()
        .and_then(|mut runtime| runtime.terminals.remove(&terminal_id).map(|session| session.child));
    if let Some(mut child) = child {
        let _ = child.kill();
        let _ = child.wait();
        true
    } else {
        false
    }
}

#[tauri::command]
async fn restart_backend(app: AppHandle) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let runtime = app.state::<ShellState>();
        let (data_dir, url) = runtime
            .runtime
            .lock()
            .map_err(|error| error.to_string())
            .and_then(|runtime| {
                Ok((
                    runtime.data_dir.clone().ok_or("Application data directory is unavailable.")?,
                    runtime.app_url.clone().ok_or("Backend URL is unavailable.")?,
                ))
            })?;
        set_splash_message(&app, "Restarting the RequestLoom backend…");
        stop_backend(&app);
        let token = match start_backend(&app, &data_dir, &url) {
            Ok(token) => token,
            Err(error) => {
                show_error(&app, "RequestLoom could not restart", &error);
                set_splash_message(&app, &error);
                return Err(error);
            }
        };
        if let Err(error) = wait_for_backend(&app, &url, &token) {
            stop_backend(&app);
            show_error(&app, "RequestLoom could not restart", &error);
            set_splash_message(&app, &error);
            return Err(error);
        }
        if let Some(window) = app.get_webview_window("main") {
            let frontend_url = if cfg!(debug_assertions) {
                DEV_FRONTEND_URL
            } else {
                &url
            };
            window.navigate(frontend_url.parse().map_err(|error: url::ParseError| error.to_string())?)
                .map_err(|error| error.to_string())?;
        }
        Ok(true)
    })
    .await
    .map_err(|error| error.to_string())?
}

pub fn run() {
    tauri::Builder::default()
        .manage(ShellState::default())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            restore_main_window(app);
        }))
        .invoke_handler(tauri::generate_handler![
            select_directory,
            reveal_path,
            save_file,
            write_clipboard,
            open_oauth_window,
            start_terminal,
            write_terminal,
            kill_terminal,
            restart_backend,
        ])
        .setup(|app| {
            #[cfg(debug_assertions)]
            app.add_capability(native_capability(format!("{DEV_FRONTEND_URL}/*")))?;

            let handle = app.handle().clone();
            let navigation_handle = handle.clone();
            let window_label = "main";
            WebviewWindowBuilder::new(app, window_label, WebviewUrl::App("index.html".into()))
                // Let WebView2 deliver HTML drag events to tabs and the collection tree.
                .disable_drag_drop_handler()
                .title("RequestLoom")
                .inner_size(1480.0, 920.0)
                .min_inner_size(1024.0, 680.0)
                .resizable(true)
                .maximizable(true)
                .minimizable(true)
                .closable(true)
                .decorations(false)
                .on_navigation(move |url| {
                    if is_main_navigation_allowed(&navigation_handle, &url) {
                        return true;
                    }
                    if matches!(url.scheme(), "http" | "https" | "mailto") {
                        let _ = open_url(url.as_str());
                    }
                    false
                })
                .on_new_window(|url, _| {
                    if matches!(url.scheme(), "http" | "https" | "mailto") {
                        let _ = open_url(url.as_str());
                    }
                    tauri::webview::NewWindowResponse::Deny
                })
                .build()?;
            tauri::async_runtime::spawn(async move { launch_application(handle).await });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to initialize RequestLoom")
        .run(|app, event| match event {
            tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. } => {
                stop_backend(app);
                let terminals = app
                    .state::<ShellState>()
                    .runtime
                    .lock()
                    .ok()
                    .map(|mut runtime| runtime.terminals.drain().map(|(_, session)| session.child).collect::<Vec<_>>())
                    .unwrap_or_default();
                for mut child in terminals {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
            tauri::RunEvent::WindowEvent { label, event, .. }
                if label == "main" && matches!(event, tauri::WindowEvent::Resized(_)) =>
            {
                focus_events(app);
            }
            _ => {}
        });
}
