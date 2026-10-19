using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RequestLoom.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddNestedFolders : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "parent_folder_id",
                table: "request_folders",
                type: "TEXT",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_request_folders_parent_folder_id",
                table: "request_folders",
                column: "parent_folder_id");

            migrationBuilder.AddForeignKey(
                name: "FK_request_folders_request_folders_parent_folder_id",
                table: "request_folders",
                column: "parent_folder_id",
                principalTable: "request_folders",
                principalColumn: "id",
                onDelete: ReferentialAction.Cascade);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_request_folders_request_folders_parent_folder_id",
                table: "request_folders");

            migrationBuilder.DropIndex(
                name: "IX_request_folders_parent_folder_id",
                table: "request_folders");

            migrationBuilder.DropColumn(
                name: "parent_folder_id",
                table: "request_folders");
        }
    }
}
