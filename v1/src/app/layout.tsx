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
      <body className={`${inter.className} bg-gradient-to-br from-[#1a1a2e] via-[#16213e] to-[#0f3460] text-white`}>
        <div className="navbar bg-base-100 bg-opacity-30 backdrop-blur-md shadow-lg fixed top-0 left-0 z-50"> 
          <div className="navbar-start">
            <a href="/" className="btn btn-ghost text-xl white-text">SocketSpace</a>
          </div>
          <div className="navbar-end">
            <a href="/" className="btn btn-ghost">Home</a>
            <a href="/chat" className="btn btn-ghost">Chat</a>
          </div>
        </div>

        <main className="pt-20 pb-16">
          {children}
        </main>

        <footer className="footer footer-center p-4 bg-base-300 bg-opacity-30 text-base-content fixed bottom-0 left-0 z-50">
          <aside>
            <p>Copyright {new Date().getFullYear()} - All right reserved by SocketSpace</p>
          </aside>
        </footer>
      </body>
    </html>
  )
}
