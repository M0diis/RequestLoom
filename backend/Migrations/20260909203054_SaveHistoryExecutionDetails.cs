using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RequestLoom.Api.Migrations
{
    /// <inheritdoc />
    public partial class SaveHistoryExecutionDetails : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "is_soap_fault",
                table: "history",
                type: "INTEGER",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "response_content_type",
                table: "history",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "response_error",
                table: "history",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "response_is_truncated",
                table: "history",
                type: "INTEGER",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "response_status_text",
                table: "history",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "script_logs_json",
                table: "history",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "script_variables_json",
                table: "history",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "service_script_variables_json",
                table: "history",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "soap_fault_json",
                table: "history",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "test_results_json",
                table: "history",
                type: "TEXT",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "is_soap_fault",
                table: "history");

            migrationBuilder.DropColumn(
                name: "response_content_type",
                table: "history");

            migrationBuilder.DropColumn(
                name: "response_error",
                table: "history");

            migrationBuilder.DropColumn(
                name: "response_is_truncated",
                table: "history");

            migrationBuilder.DropColumn(
                name: "response_status_text",
                table: "history");

            migrationBuilder.DropColumn(
                name: "script_logs_json",
                table: "history");

            migrationBuilder.DropColumn(
                name: "script_variables_json",
                table: "history");

            migrationBuilder.DropColumn(
                name: "service_script_variables_json",
                table: "history");

            migrationBuilder.DropColumn(
                name: "soap_fault_json",
                table: "history");

            migrationBuilder.DropColumn(
                name: "test_results_json",
                table: "history");
        }
    }
}
