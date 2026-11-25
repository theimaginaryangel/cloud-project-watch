import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TagWatch — AWS Project Cost & Zombie Tracker",
    short_name: "TagWatch",
    description:
      "Track AWS costs by project, catch untagged zombie resources, and cut burn surgically without running terraform destroy.",
    start_url: "/",
    display: "standalone",
    background_color: "#0f1117",
    theme_color: "#0f1117",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
  };
}
