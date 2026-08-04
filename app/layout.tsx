import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const image = `${protocol}://${host}/og.png`;

  return {
    title: "Daymark — Daily habit tracker",
    description: "Plan tomorrow, follow your rhythm, and close out each day with intention.",
    openGraph: {
      title: "Daymark — Plan tomorrow. Finish today.",
      description: "A calm daily timeline for habits, small steps, and honest evening check-ins.",
      images: [{ url: image, width: 1680, height: 910, alt: "Daymark daily habit tracker" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Daymark — Plan tomorrow. Finish today.",
      description: "A calm daily timeline for habits, small steps, and honest evening check-ins.",
      images: [image],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={geist.variable}>{children}</body>
    </html>
  );
}
