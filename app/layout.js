import "./globals.css";

export const metadata = {
  title: "IPO Board",
  description: "Indian IPO calendar and market data",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
