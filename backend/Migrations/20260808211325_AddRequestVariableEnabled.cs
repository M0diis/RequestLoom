using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RequestLoom.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddRequestVariableEnabled : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "enabled",
                table: "request_variables",
                type: "INTEGER",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "enabled",
                table: "request_variables");
        }
    }
}
