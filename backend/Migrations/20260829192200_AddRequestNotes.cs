using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using RequestLoom.Api.Data;

#nullable disable

namespace RequestLoom.Api.Migrations;

[DbContext(typeof(AppDbContext))]
[Migration("20260829192200_AddRequestNotes")]
public partial class AddRequestNotes : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<string>(
            name: "notes",
            table: "requests",
            type: "TEXT",
            nullable: false,
            defaultValue: "");
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropColumn(
            name: "notes",
            table: "requests");
    }
}
