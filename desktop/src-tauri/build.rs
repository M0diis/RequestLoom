static COMMANDS: &[&str] = &[
    "select_directory",
    "reveal_path",
    "save_file",
    "write_clipboard",
    "open_oauth_window",
    "start_terminal",
    "write_terminal",
    "kill_terminal",
    "restart_backend",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("failed to build RequestLoom's Tauri permissions");
}
