import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

type BoardColumn = {
  column: "Inbox" | "Planning" | "Development" | "Review" | "Done";
  items: string[];
};

const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || "/Users/m/.openclaw/workspace";
const BOARD_PATH = path.join(WORKSPACE_ROOT, "mission-control", "board.md");
const COLUMNS: BoardColumn["column"][] = ["Inbox", "Planning", "Development", "Review", "Done"];

function parseListBlock(content: string, heading: string) {
  const regex = new RegExp(`## ${heading}([\\s\\S]*?)(?=\\n## |$)`);
  const match = content.match(regex);
  if (!match) return [] as string[];
  return match[1]
    .split("\n")
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter((line) => line.length > 0);
}

export async function GET() {
  try {
    if (!fs.existsSync(BOARD_PATH)) {
      return NextResponse.json({ error: "board.md not found", board: [] }, { status: 404 });
    }

    const content = fs.readFileSync(BOARD_PATH, "utf8");
    const board = COLUMNS.map((column) => ({
      column,
      items: parseListBlock(content, column),
    }));

    return NextResponse.json({
      source: "filesystem",
      path: BOARD_PATH,
      board,
      updatedAt: fs.statSync(BOARD_PATH).mtimeMs,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load board", board: [] },
      { status: 500 }
    );
  }
}
