using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RequestLoom.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddRequestFolders : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "folder_id",
                table: "requests",
                type: "TEXT",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "request_folders",
                columns: table => new
                {
                    id = table.Column<string>(type: "TEXT", nullable: false),
                    service_id = table.Column<string>(type: "TEXT", nullable: false),
                    name = table.Column<string>(type: "TEXT", nullable: false),
                    sort_order = table.Column<int>(type: "INTEGER", nullable: false),
                    created_at = table.Column<string>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_request_folders", x => x.id);
                    table.ForeignKey(
                        name: "FK_request_folders_services_service_id",
                        column: x => x.service_id,
                        principalTable: "services",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_requests_folder_id",
                table: "requests",
                column: "folder_id");

            migrationBuilder.CreateIndex(
                name: "IX_request_folders_service_id",
                table: "request_folders",
                column: "service_id");

            migrationBuilder.AddForeignKey(
                name: "FK_requests_request_folders_folder_id",
                table: "requests",
                column: "folder_id",
                principalTable: "request_folders",
                principalColumn: "id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_requests_request_folders_folder_id",
                table: "requests");

            migrationBuilder.DropTable(
                name: "request_folders");

            migrationBuilder.DropIndex(
                name: "IX_requests_folder_id",
                table: "requests");

            migrationBuilder.DropColumn(
                name: "folder_id",
                table: "requests");
        }
    }
}
