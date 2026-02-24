export const metadata = {
  title: 'Mastermind — 7DTD Server Manager',
  description: 'Control Plane + Host Agent',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
