using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using RequestLoom.Api.Data;

#nullable disable

namespace RequestLoom.Api.Migrations;

[DbContext(typeof(AppDbContext))]
[Migration("20260901100000_AddMockEndpointBehaviors")]
public partial class AddMockEndpointBehaviors : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<string>(
            name: "behavior",
            table: "mock_server_endpoints",
            type: "TEXT",
            nullable: false,
            defaultValue: "static");

        migrationBuilder.AddColumn<string>(
            name: "behavior_config_json",
            table: "mock_server_endpoints",
            type: "TEXT",
            nullable: false,
            defaultValue: "{}");
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropColumn(
            name: "behavior",
            table: "mock_server_endpoints");

        migrationBuilder.DropColumn(
            name: "behavior_config_json",
            table: "mock_server_endpoints");
    }
}
