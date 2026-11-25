import { ProjectDetailView } from "@/components/project-detail-view";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <ProjectDetailView slug={decodeURIComponent(slug)} />;
}
