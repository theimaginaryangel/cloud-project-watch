import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const filePath = path.join(process.cwd(), "infra", "readonly-iam.yaml");
    const content = await fs.readFile(filePath, "utf8");
    return new NextResponse(content, {
      headers: {
        "Content-Type": "text/yaml; charset=utf-8",
        "Content-Disposition": 'attachment; filename="cloudprojectwatch-readonly-iam.yaml"',
      },
    });
  } catch {
    return NextResponse.json(
      { error: "CloudFormation template not found." },
      { status: 404 },
    );
  }
}
