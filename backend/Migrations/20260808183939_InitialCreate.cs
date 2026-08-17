using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RequestLoom.Api.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "workspaces",
                columns: table => new
                {
                    id = table.Column<string>(type: "TEXT", nullable: false),
                    name = table.Column<string>(type: "TEXT", nullable: false),
                    created_at = table.Column<string>(type: "TEXT", nullable: false),
                    updated_at = table.Column<string>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_workspaces", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "environments",
                columns: table => new
                {
                    id = table.Column<string>(type: "TEXT", nullable: false),
                    workspace_id = table.Column<string>(type: "TEXT", nullable: false),
                    name = table.Column<string>(type: "TEXT", nullable: false),
                    is_active = table.Column<bool>(type: "INTEGER", nullable: false),
                    sort_order = table.Column<int>(type: "INTEGER", nullable: false),
                    created_at = table.Column<string>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_environments", x => x.id);
                    table.ForeignKey(
                        name: "FK_environments_workspaces_workspace_id",
                        column: x => x.workspace_id,
                        principalTable: "workspaces",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "mock_servers",
                columns: table => new
                {
                    id = table.Column<string>(type: "TEXT", nullable: false),
                    workspace_id = table.Column<string>(type: "TEXT", nullable: false),
                    name = table.Column<string>(type: "TEXT", nullable: false),
                    description = table.Column<string>(type: "TEXT", nullable: false),
                    slug = table.Column<string>(type: "TEXT", nullable: false),
                    port = table.Column<int>(type: "INTEGER", nullable: false),
                    is_running = table.Column<bool>(type: "INTEGER", nullable: false),
                    created_at = table.Column<string>(type: "TEXT", nullable: false),
                    updated_at = table.Column<string>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_mock_servers", x => x.id);
                    table.ForeignKey(
                        name: "FK_mock_servers_workspaces_workspace_id",
                        column: x => x.workspace_id,
                        principalTable: "workspaces",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "services",
                columns: table => new
                {
                    id = table.Column<string>(type: "TEXT", nullable: false),
                    workspace_id = table.Column<string>(type: "TEXT", nullable: false),
                    name = table.Column<string>(type: "TEXT", nullable: false),
                    description = table.Column<string>(type: "TEXT", nullable: false),
                    sort_order = table.Column<int>(type: "INTEGER", nullable: false),
                    created_at = table.Column<string>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_services", x => x.id);
                    table.ForeignKey(
                        name: "FK_services_workspaces_workspace_id",
                        column: x => x.workspace_id,
                        principalTable: "workspaces",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "environment_variables",
                columns: table => new
                {
                    id = table.Column<string>(type: "TEXT", nullable: false),
                    environment_id = table.Column<string>(type: "TEXT", nullable: false),
                    key = table.Column<string>(type: "TEXT", nullable: false),
                    value = table.Column<string>(type: "TEXT", nullable: false),
                    is_secret = table.Column<bool>(type: "INTEGER", nullable: false),
                    enabled = table.Column<bool>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_environment_variables", x => x.id);
                    table.ForeignKey(
                        name: "FK_environment_variables_environments_environment_id",
                        column: x => x.environment_id,
                        principalTable: "environments",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "workspace_variables",
                columns: table => new
                {
                    id = table.Column<string>(type: "TEXT", nullable: false),
                    workspace_id = table.Column<string>(type: "TEXT", nullable: false),
                    environment_id = table.Column<string>(type: "TEXT", nullable: true),
                    key = table.Column<string>(type: "TEXT", nullable: false),
                    value = table.Column<string>(type: "TEXT", nullable: false),
                    is_secret = table.Column<bool>(type: "INTEGER", nullable: false),
                    enabled = table.Column<bool>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_workspace_variables", x => x.id);
                    table.ForeignKey(
                        name: "FK_workspace_variables_environments_environment_id",
                        column: x => x.environment_id,
                        principalTable: "environments",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_workspace_variables_workspaces_workspace_id",
                        column: x => x.workspace_id,
                        principalTable: "workspaces",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "mock_server_endpoints",
                columns: table => new
                {
                    id = table.Column<string>(type: "TEXT", nullable: false),
                    mock_server_id = table.Column<string>(type: "TEXT", nullable: false),
                    method = table.Column<string>(type: "TEXT", nullable: false),
                    path = table.Column<string>(type: "TEXT", nullable: false),
                    status_code = table.Column<int>(type: "INTEGER", nullable: false),
                    content_type = table.Column<string>(type: "TEXT", nullable: false),
                    response_body = table.Column<string>(type: "TEXT", nullable: false),
                    response_headers_json = table.Column<string>(type: "TEXT", nullable: false),
                    script_enabled = table.Column<bool>(type: "INTEGER", nullable: false),
                    script = table.Column<string>(type: "TEXT", nullable: false),
                    delay_ms = table.Column<int>(type: "INTEGER", nullable: false),
                    sort_order = table.Column<int>(type: "INTEGER", nullable: false),
                    created_at = table.Column<string>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_mock_server_endpoints", x => x.id);
                    table.ForeignKey(
                        name: "FK_mock_server_endpoints_mock_servers_mock_server_id",
                        column: x => x.mock_server_id,
                        principalTable: "mock_servers",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "requests",
                columns: table => new
                {
                    id = table.Column<string>(type: "TEXT", nullable: false),
                    service_id = table.Column<string>(type: "TEXT", nullable: false),
                    name = table.Column<string>(type: "TEXT", nullable: false),
                    method = table.Column<string>(type: "TEXT", nullable: false),
                    url = table.Column<string>(type: "TEXT", nullable: false),
                    body = table.Column<string>(type: "TEXT", nullable: true),
                    body_type = table.Column<string>(type: "TEXT", nullable: false),
                    pre_request_script = table.Column<string>(type: "TEXT", nullable: false),
                    post_request_script = table.Column<string>(type: "TEXT", nullable: false),
                    test_script = table.Column<string>(type: "TEXT", nullable: false),
                    sort_order = table.Column<int>(type: "INTEGER", nullable: false),
                    is_favorite = table.Column<bool>(type: "INTEGER", nullable: false),
                    created_at = table.Column<string>(type: "TEXT", nullable: false),
                    updated_at = table.Column<string>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_requests", x => x.id);
                    table.ForeignKey(
                        name: "FK_requests_services_service_id",
                        column: x => x.service_id,
                        principalTable: "services",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "service_auth",
                columns: table => new
                {
                    id = table.Column<string>(type: "TEXT", nullable: false),
                    service_id = table.Column<string>(type: "TEXT", nullable: false),
                    auth_type = table.Column<string>(type: "TEXT", nullable: false),
                    config_json = table.Column<string>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_service_auth", x => x.id);
                    table.ForeignKey(
                        name: "FK_service_auth_services_service_id",
                        column: x => x.service_id,
                        principalTable: "services",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "service_headers",
                columns: table => new
                {
                    id = table.Column<string>(type: "TEXT", nullable: false),
                    service_id = table.Column<string>(type: "TEXT", nullable: false),
                    key = table.Column<string>(type: "TEXT", nullable: false),
                    value = table.Column<string>(type: "TEXT", nullable: false),
                    enabled = table.Column<bool>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_service_headers", x => x.id);
                    table.ForeignKey(
                        name: "FK_service_headers_services_service_id",
                        column: x => x.service_id,
                        principalTable: "services",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "service_variables",
                columns: table => new
                {
                    id = table.Column<string>(type: "TEXT", nullable: false),
                    service_id = table.Column<string>(type: "TEXT", nullable: false),
                    environment_id = table.Column<string>(type: "TEXT", nullable: true),
                    key = table.Column<string>(type: "TEXT", nullable: false),
                    value = table.Column<string>(type: "TEXT", nullable: false),
                    is_secret = table.Column<bool>(type: "INTEGER", nullable: false),
                    enabled = table.Column<bool>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_service_variables", x => x.id);
                    table.ForeignKey(
                        name: "FK_service_variables_services_service_id",
                        column: x => x.service_id,
                        principalTable: "services",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "history",
                columns: table => new
                {
                    id = table.Column<string>(type: "TEXT", nullable: false),
                    request_id = table.Column<string>(type: "TEXT", nullable: true),
                    workspace_id = table.Column<string>(type: "TEXT", nullable: false),
                    method = table.Column<string>(type: "TEXT", nullable: false),
                    url = table.Column<string>(type: "TEXT", nullable: false),
                    request_headers_json = table.Column<string>(type: "TEXT", nullable: true),
                    request_body = table.Column<string>(type: "TEXT", nullable: true),
                    response_status = table.Column<int>(type: "INTEGER", nullable: false),
                    response_headers_json = table.Column<string>(type: "TEXT", nullable: true),
                    response_body = table.Column<string>(type: "TEXT", nullable: true),
                    response_time_ms = table.Column<long>(type: "INTEGER", nullable: false),
                    response_size_bytes = table.Column<long>(type: "INTEGER", nullable: false),
                    executed_at = table.Column<string>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_history", x => x.id);
                    table.ForeignKey(
                        name: "FK_history_requests_request_id",
                        column: x => x.request_id,
                        principalTable: "requests",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_history_workspaces_workspace_id",
                        column: x => x.workspace_id,
                        principalTable: "workspaces",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "request_auth",
                columns: table => new
                {
                    id = table.Column<string>(type: "TEXT", nullable: false),
                    request_id = table.Column<string>(type: "TEXT", nullable: false),
                    auth_type = table.Column<string>(type: "TEXT", nullable: false),
                    config_json = table.Column<string>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_request_auth", x => x.id);
                    table.ForeignKey(
                        name: "FK_request_auth_requests_request_id",
                        column: x => x.request_id,
                        principalTable: "requests",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "request_headers",
                columns: table => new
                {
                    id = table.Column<string>(type: "TEXT", nullable: false),
                    request_id = table.Column<string>(type: "TEXT", nullable: false),
                    key = table.Column<string>(type: "TEXT", nullable: false),
                    value = table.Column<string>(type: "TEXT", nullable: false),
                    enabled = table.Column<bool>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_request_headers", x => x.id);
                    table.ForeignKey(
                        name: "FK_request_headers_requests_request_id",
                        column: x => x.request_id,
                        principalTable: "requests",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "request_params",
                columns: table => new
                {
                    id = table.Column<string>(type: "TEXT", nullable: false),
                    request_id = table.Column<string>(type: "TEXT", nullable: false),
                    key = table.Column<string>(type: "TEXT", nullable: false),
                    value = table.Column<string>(type: "TEXT", nullable: false),
                    enabled = table.Column<bool>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_request_params", x => x.id);
                    table.ForeignKey(
                        name: "FK_request_params_requests_request_id",
                        column: x => x.request_id,
                        principalTable: "requests",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "request_variables",
                columns: table => new
                {
                    id = table.Column<string>(type: "TEXT", nullable: false),
                    request_id = table.Column<string>(type: "TEXT", nullable: false),
                    key = table.Column<string>(type: "TEXT", nullable: false),
                    value = table.Column<string>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_request_variables", x => x.id);
                    table.ForeignKey(
                        name: "FK_request_variables_requests_request_id",
                        column: x => x.request_id,
                        principalTable: "requests",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_environment_variables_environment_id_key",
                table: "environment_variables",
                columns: new[] { "environment_id", "key" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_environments_workspace_id",
                table: "environments",
                column: "workspace_id");

            migrationBuilder.CreateIndex(
                name: "IX_history_executed_at",
                table: "history",
                column: "executed_at");

            migrationBuilder.CreateIndex(
                name: "IX_history_request_id",
                table: "history",
                column: "request_id");

            migrationBuilder.CreateIndex(
                name: "IX_history_workspace_id",
                table: "history",
                column: "workspace_id");

            migrationBuilder.CreateIndex(
                name: "IX_mock_server_endpoints_mock_server_id",
                table: "mock_server_endpoints",
                column: "mock_server_id");

            migrationBuilder.CreateIndex(
                name: "IX_mock_servers_slug",
                table: "mock_servers",
                column: "slug",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_mock_servers_workspace_id",
                table: "mock_servers",
                column: "workspace_id");

            migrationBuilder.CreateIndex(
                name: "IX_request_auth_request_id",
                table: "request_auth",
                column: "request_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_request_headers_request_id",
                table: "request_headers",
                column: "request_id");

            migrationBuilder.CreateIndex(
                name: "IX_request_params_request_id",
                table: "request_params",
                column: "request_id");

            migrationBuilder.CreateIndex(
                name: "IX_request_variables_request_id",
                table: "request_variables",
                column: "request_id");

            migrationBuilder.CreateIndex(
                name: "IX_requests_service_id",
                table: "requests",
                column: "service_id");

            migrationBuilder.CreateIndex(
                name: "IX_service_auth_service_id",
                table: "service_auth",
                column: "service_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_service_headers_service_id",
                table: "service_headers",
                column: "service_id");

            migrationBuilder.CreateIndex(
                name: "IX_service_variables_service_id",
                table: "service_variables",
                column: "service_id");

            migrationBuilder.CreateIndex(
                name: "IX_services_workspace_id",
                table: "services",
                column: "workspace_id");

            migrationBuilder.CreateIndex(
                name: "IX_workspace_variables_environment_id",
                table: "workspace_variables",
                column: "environment_id");

            migrationBuilder.CreateIndex(
                name: "IX_workspace_variables_workspace_id",
                table: "workspace_variables",
                column: "workspace_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "environment_variables");

            migrationBuilder.DropTable(
                name: "history");

            migrationBuilder.DropTable(
                name: "mock_server_endpoints");

            migrationBuilder.DropTable(
                name: "request_auth");

            migrationBuilder.DropTable(
                name: "request_headers");

            migrationBuilder.DropTable(
                name: "request_params");

            migrationBuilder.DropTable(
                name: "request_variables");

            migrationBuilder.DropTable(
                name: "service_auth");

            migrationBuilder.DropTable(
                name: "service_headers");

            migrationBuilder.DropTable(
                name: "service_variables");

            migrationBuilder.DropTable(
                name: "workspace_variables");

            migrationBuilder.DropTable(
                name: "mock_servers");

            migrationBuilder.DropTable(
                name: "requests");

            migrationBuilder.DropTable(
                name: "environments");

            migrationBuilder.DropTable(
                name: "services");

            migrationBuilder.DropTable(
                name: "workspaces");
        }
    }
}
