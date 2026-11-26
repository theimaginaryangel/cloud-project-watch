import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { enforceApiGuard } from "@/lib/security/guards";

export async function GET(request: Request) {
  const blocked = await enforceApiGuard(request);
  if (blocked) return blocked;

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
