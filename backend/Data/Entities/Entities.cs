using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace RequestLoom.Api.Data.Entities;

[Table("workspaces")]
public class WorkspaceRow
{
    [Key, Column("id")] public string Id { get; set; } = "";
    [Column("name")] public string Name { get; set; } = "";
    [Column("created_at")] public string CreatedAt { get; set; } = "";
    [Column("updated_at")] public string UpdatedAt { get; set; } = "";
}

[Table("environments")]
public class EnvironmentRow
{
    [Key, Column("id")] public string Id { get; set; } = "";
    [Column("workspace_id")] public string WorkspaceId { get; set; } = "";
    [Column("name")] public string Name { get; set; } = "";
    [Column("is_active")] public bool IsActive { get; set; }
    [Column("sort_order")] public int SortOrder { get; set; }
    [Column("created_at")] public string CreatedAt { get; set; } = "";
}

[Table("environment_variables")]
public class EnvironmentVariableRow
{
    [Key, Column("id")] public string Id { get; set; } = "";
    [Column("environment_id")] public string EnvironmentId { get; set; } = "";
    [Column("key")] public string Key { get; set; } = "";
    [Column("value")] public string Value { get; set; } = "";
    [Column("is_secret")] public bool IsSecret { get; set; }
    [Column("enabled")] public bool Enabled { get; set; } = true;
}

[Table("services")]
public class ServiceRow
{
    [Key, Column("id")] public string Id { get; set; } = "";
    [Column("workspace_id")] public string WorkspaceId { get; set; } = "";
    [Column("name")] public string Name { get; set; } = "";
    [Column("description")] public string Description { get; set; } = "";
    [Column("sort_order")] public int SortOrder { get; set; }
    [Column("created_at")] public string CreatedAt { get; set; } = "";
}

[Table("requests")]
public class ApiRequestRow
{
    [Key, Column("id")] public string Id { get; set; } = "";
    [Column("service_id")] public string ServiceId { get; set; } = "";
    [Column("folder_id")] public string? FolderId { get; set; }
    [Column("name")] public string Name { get; set; } = "";
    [Column("method")] public string Method { get; set; } = "GET";
    [Column("url")] public string Url { get; set; } = "";
    [Column("body")] public string? Body { get; set; }
    [Column("body_type")] public string BodyType { get; set; } = "none";
    [Column("pre_request_script")] public string PreRequestScript { get; set; } = "";
    [Column("post_request_script")] public string PostRequestScript { get; set; } = "";
    [Column("test_script")] public string TestScript { get; set; } = "";
    [Column("notes")] public string Notes { get; set; } = "";
    [Column("sort_order")] public int SortOrder { get; set; }
    [Column("is_favorite")] public bool IsFavorite { get; set; }
    [Column("created_at")] public string CreatedAt { get; set; } = "";
    [Column("updated_at")] public string UpdatedAt { get; set; } = "";
}

[Table("request_folders")]
public class RequestFolderRow
{
    [Key, Column("id")] public string Id { get; set; } = "";
    [Column("service_id")] public string ServiceId { get; set; } = "";
    [Column("name")] public string Name { get; set; } = "";
    [Column("sort_order")] public int SortOrder { get; set; }
    [Column("created_at")] public string CreatedAt { get; set; } = "";
}

[Table("request_headers")]
public class RequestHeaderRow
{
    [Key, Column("id")] public string Id { get; set; } = "";
    [Column("request_id")] public string RequestId { get; set; } = "";
    [Column("key")] public string Key { get; set; } = "";
    [Column("value")] public string Value { get; set; } = "";
    [Column("enabled")] public bool Enabled { get; set; } = true;
}

[Table("request_params")]
public class RequestParamRow
{
    [Key, Column("id")] public string Id { get; set; } = "";
    [Column("request_id")] public string RequestId { get; set; } = "";
    [Column("key")] public string Key { get; set; } = "";
    [Column("value")] public string Value { get; set; } = "";
    [Column("enabled")] public bool Enabled { get; set; } = true;
}

[Table("request_variables")]
public class RequestVariableRow
{
    [Key, Column("id")] public string Id { get; set; } = "";
    [Column("request_id")] public string RequestId { get; set; } = "";
    [Column("key")] public string Key { get; set; } = "";
    [Column("value")] public string Value { get; set; } = "";
    [Column("enabled")] public bool Enabled { get; set; } = true;
}

[Table("request_settings")]
public class RequestSettingsRow
{
    [Key, Column("id")] public string Id { get; set; } = "";
    [Column("request_id")] public string RequestId { get; set; } = "";
    [Column("follow_redirects")] public bool FollowRedirects { get; set; } = true;
    [Column("max_redirects")] public int MaxRedirects { get; set; } = 10;
    [Column("ignore_ssl_errors")] public bool IgnoreSslErrors { get; set; }
    [Column("timeout_seconds")] public int? TimeoutSeconds { get; set; }
    [Column("proxy_mode")] public string ProxyMode { get; set; } = "inherit";
    [Column("proxy_url")] public string ProxyUrl { get; set; } = "";
    [Column("proxy_username")] public string ProxyUsername { get; set; } = "";
    [Column("proxy_password")] public string ProxyPassword { get; set; } = "";
}

[Table("request_auth")]
public class RequestAuthRow
{
    [Key, Column("id")] public string Id { get; set; } = "";
    [Column("request_id")] public string RequestId { get; set; } = "";
    [Column("auth_type")] public string AuthType { get; set; } = "none";
    [Column("config_json")] public string ConfigJson { get; set; } = "{}";
}

[Table("service_headers")]
public class ServiceHeaderRow
{
    [Key, Column("id")] public string Id { get; set; } = "";
    [Column("service_id")] public string ServiceId { get; set; } = "";
    [Column("key")] public string Key { get; set; } = "";
    [Column("value")] public string Value { get; set; } = "";
    [Column("enabled")] public bool Enabled { get; set; } = true;
}

[Table("service_auth")]
public class ServiceAuthRow
{
    [Key, Column("id")] public string Id { get; set; } = "";
    [Column("service_id")] public string ServiceId { get; set; } = "";
    [Column("auth_type")] public string AuthType { get; set; } = "none";
    [Column("config_json")] public string ConfigJson { get; set; } = "{}";
}

[Table("workspace_variables")]
public class WorkspaceVariableRow
{
    [Key, Column("id")] public string Id { get; set; } = "";
    [Column("workspace_id")] public string WorkspaceId { get; set; } = "";
    [Column("environment_id")] public string? EnvironmentId { get; set; }
    [Column("key")] public string Key { get; set; } = "";
    [Column("value")] public string Value { get; set; } = "";
    [Column("is_secret")] public bool IsSecret { get; set; }
    [Column("enabled")] public bool Enabled { get; set; } = true;
}

[Table("service_variables")]
public class ServiceVariableRow
{
    [Key, Column("id")] public string Id { get; set; } = "";
    [Column("service_id")] public string ServiceId { get; set; } = "";
    [Column("environment_id")] public string? EnvironmentId { get; set; }
    [Column("key")] public string Key { get; set; } = "";
    [Column("value")] public string Value { get; set; } = "";
    [Column("is_secret")] public bool IsSecret { get; set; }
    [Column("enabled")] public bool Enabled { get; set; } = true;
}

[Table("history")]
public class HistoryRow
{
    [Key, Column("id")] public string Id { get; set; } = "";
    [Column("request_id")] public string? RequestId { get; set; }
    [Column("workspace_id")] public string WorkspaceId { get; set; } = "";
    [Column("method")] public string Method { get; set; } = "";
    [Column("url")] public string Url { get; set; } = "";
    [Column("request_headers_json")] public string? RequestHeadersJson { get; set; }
    [Column("request_body")] public string? RequestBody { get; set; }
    [Column("response_status")] public int ResponseStatus { get; set; }
    [Column("response_headers_json")] public string? ResponseHeadersJson { get; set; }
    [Column("response_body")] public string? ResponseBody { get; set; }
    [Column("response_time_ms")] public long ResponseTimeMs { get; set; }
    [Column("response_size_bytes")] public long ResponseSizeBytes { get; set; }
    [Column("executed_at")] public string ExecutedAt { get; set; } = "";
}

[Table("mock_servers")]
public class MockServerRow
{
    [Key, Column("id")] public string Id { get; set; } = "";
    [Column("workspace_id")] public string WorkspaceId { get; set; } = "";
    [Column("name")] public string Name { get; set; } = "";
    [Column("description")] public string Description { get; set; } = "";
    [Column("slug")] public string Slug { get; set; } = "";
    [Column("port")] public int Port { get; set; }
    [Column("is_running")] public bool IsRunning { get; set; }
    [Column("created_at")] public string CreatedAt { get; set; } = "";
    [Column("updated_at")] public string UpdatedAt { get; set; } = "";
}

[Table("mock_server_endpoints")]
public class MockServerEndpointRow
{
    [Key, Column("id")] public string Id { get; set; } = "";
    [Column("mock_server_id")] public string MockServerId { get; set; } = "";
    [Column("method")] public string Method { get; set; } = "GET";
    [Column("path")] public string Path { get; set; } = "/";
    [Column("status_code")] public int StatusCode { get; set; } = 200;
    [Column("content_type")] public string ContentType { get; set; } = "application/json";
    [Column("response_body")] public string ResponseBody { get; set; } = "";
    [Column("response_headers_json")] public string ResponseHeadersJson { get; set; } = "[]";
    [Column("script_enabled")] public bool ScriptEnabled { get; set; }
    [Column("script")] public string Script { get; set; } = "";
    [Column("behavior")] public string Behavior { get; set; } = "static";
    [Column("behavior_config_json")] public string BehaviorConfigJson { get; set; } = "{}";
    [Column("delay_ms")] public int DelayMs { get; set; }
    [Column("sort_order")] public int SortOrder { get; set; }
    [Column("created_at")] public string CreatedAt { get; set; } = "";
}
