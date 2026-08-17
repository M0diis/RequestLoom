using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RequestLoom.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddRequestSettings : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "request_settings",
                columns: table => new
                {
                    id = table.Column<string>(type: "TEXT", nullable: false),
                    request_id = table.Column<string>(type: "TEXT", nullable: false),
                    follow_redirects = table.Column<bool>(type: "INTEGER", nullable: false),
                    ignore_ssl_errors = table.Column<bool>(type: "INTEGER", nullable: false),
                    timeout_seconds = table.Column<int>(type: "INTEGER", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_request_settings", x => x.id);
                    table.ForeignKey(
                        name: "FK_request_settings_requests_request_id",
                        column: x => x.request_id,
                        principalTable: "requests",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_request_settings_request_id",
                table: "request_settings",
                column: "request_id",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "request_settings");
        }
    }
}
