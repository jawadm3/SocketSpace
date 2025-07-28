// app/layout.tsx
import "./globals.css"
import { Inter } from "next/font/google"

const inter = Inter({ subsets: ["latin"] })

export const metadata = {
  title: "SocketSpace",
  description: "Real-time anonymous chat app",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.className} bg-gradient-to-b from-gray-900 to-gray-800 text-white`}>
        <div className="min-h-screen flex flex-col">
          <header className="glass-morphism p-4 fixed top-0 left-0 right-0 z-50 shadow-2xl border-b border-[#38bdf8]/30">
            <nav className="flex items-center justify-between">
              <h1 className="gradient-text text-3xl font-extrabold tracking-tight drop-shadow-lg">SocketSpace</h1>
              <div className="flex items-center space-x-4">
                <span className="inline-block w-3 h-3 rounded-full bg-[#38bdf8] neon-glow animate-float"></span>
              </div>
            </nav>
          </header>
          <main className="mt-20 flex-1">
            {children}
          </main>
          <footer className="glass-morphism p-4 fixed bottom-0 left-0 right-0 shadow-2xl border-t border-[#8f5cff]/30">
            <div className="text-center text-xs text-[#b3b8d0] tracking-wide">
              <span className="gradient-text font-bold">© 2025 SocketSpace</span> &mdash; All rights reserved.
            </div>
          </footer>
        </div>
      </body>
    </html>
  )
}
