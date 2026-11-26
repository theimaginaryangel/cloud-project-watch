import { ProjectDetailView } from "@/components/project-detail-view";

function decodeSlugSafely(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <ProjectDetailView slug={decodeSlugSafely(slug)} />;
}
