import type { Metadata } from 'next';
import 'video.js/dist/video-js.css';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'Play',
  description: 'Full-stack AWS video streaming service',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
