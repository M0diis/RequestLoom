using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RequestLoom.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddRedirectAndProxySettings : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "max_redirects",
                table: "request_settings",
                type: "INTEGER",
                nullable: false,
                defaultValue: 10);

            migrationBuilder.AddColumn<string>(
                name: "proxy_mode",
                table: "request_settings",
                type: "TEXT",
                nullable: false,
                defaultValue: "inherit");

            migrationBuilder.AddColumn<string>(
                name: "proxy_password",
                table: "request_settings",
                type: "TEXT",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "proxy_url",
                table: "request_settings",
                type: "TEXT",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "proxy_username",
                table: "request_settings",
                type: "TEXT",
                nullable: false,
                defaultValue: "");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "max_redirects",
                table: "request_settings");

            migrationBuilder.DropColumn(
                name: "proxy_mode",
                table: "request_settings");

            migrationBuilder.DropColumn(
                name: "proxy_password",
                table: "request_settings");

            migrationBuilder.DropColumn(
                name: "proxy_url",
                table: "request_settings");

            migrationBuilder.DropColumn(
                name: "proxy_username",
                table: "request_settings");
        }
    }
}
