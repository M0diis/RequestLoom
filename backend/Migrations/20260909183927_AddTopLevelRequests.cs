using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RequestLoom.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddTopLevelRequests : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "service_id",
                table: "requests",
                type: "TEXT",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "TEXT");

            migrationBuilder.AddColumn<string>(
                name: "workspace_id",
                table: "requests",
                type: "TEXT",
                nullable: false,
                defaultValue: "");

            migrationBuilder.Sql("""
                UPDATE requests
                SET workspace_id = COALESCE(
                    (SELECT workspace_id FROM services WHERE services.id = requests.service_id),
                    'default'
                )
                WHERE workspace_id = '';
                """);

            migrationBuilder.CreateIndex(
                name: "IX_requests_workspace_id",
                table: "requests",
                column: "workspace_id");

            migrationBuilder.AddForeignKey(
                name: "FK_requests_workspaces_workspace_id",
                table: "requests",
                column: "workspace_id",
                principalTable: "workspaces",
                principalColumn: "id",
                onDelete: ReferentialAction.Cascade);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_requests_workspaces_workspace_id",
                table: "requests");

            migrationBuilder.DropIndex(
                name: "IX_requests_workspace_id",
                table: "requests");

            migrationBuilder.DropColumn(
                name: "workspace_id",
                table: "requests");

            migrationBuilder.AlterColumn<string>(
                name: "service_id",
                table: "requests",
                type: "TEXT",
                nullable: false,
                defaultValue: "",
                oldClrType: typeof(string),
                oldType: "TEXT",
                oldNullable: true);
        }
    }
}
