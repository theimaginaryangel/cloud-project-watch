import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CloudProjectWatch",
    short_name: "CloudProjectWatch",
    description:
      "Track AWS spending by project, spot untagged resources, and trim monthly costs without tearing down live apps.",
    start_url: "/",
    display: "standalone",
    background_color: "#09090b",
    theme_color: "#09090b",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
  };
}
