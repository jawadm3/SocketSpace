---

```markdown
# ⚡ SocketSpace

**SocketSpace** is a real-time, anonymous one-to-one chat web application built using **Next.js**, **Tailwind CSS**, **TypeScript**, and **Socket.IO**. The goal is to create a clean, fast, and responsive chat interface with enforced **dark mode** and minimal UI distractions.

---

## 🚀 Features

- 🔒 Anonymous 1-to-1 real-time chat
- 🌙 Always-on dark mode UI
- ⚡ Powered by WebSockets using Socket.IO
- 🧩 Built with modern stack: Next.js 14, TypeScript, Tailwind CSS
- 📦 Lightweight and modular frontend

---

## 🛠️ Tech Stack

| Layer     | Tech                             |
|-----------|----------------------------------|
| Frontend  | Next.js, React, TypeScript       |
| Styling   | Tailwind CSS                     |
| Backend   | Node.js, Express, Socket.IO      |
| Realtime  | WebSocket (Socket.IO)            |

---

## 📁 Project Structure

```

/socketspace
│
├── /app               # Next.js 14 App Router
│   ├── layout.tsx     # Global layout (with dark mode)
│   ├── page.tsx       # Landing page
│   └── /chat          # Main chat UI
│       └── page.tsx
│
├── /lib
│   └── socket.ts      # Socket.IO client
│
├── /public
│   └── favicon.ico
│
├── /styles
│   └── globals.css    # Tailwind and dark mode config
│
├── tailwind.config.js
├── tsconfig.json
├── next.config.js
├── server.js          # Express + Socket.IO server
└── README.md

````

---

## 🧑‍💻 Getting Started

### 1. Clone the Repo

```bash
git clone https://github.com/yourusername/socketspace.git
cd socketspace
````

### 2. Install Dependencies

```bash
npm install
```

### 3. Run the Backend Server

```bash
node server.js
# or
npm run server
```

Make sure `express` and `socket.io` are installed:

```bash
npm install express socket.io
```

### 4. Run the Next.js Frontend

```bash
npm run dev
```

Frontend runs at: `http://localhost:3000`
Backend runs at: `http://localhost:8001` *(or the port defined in server.js)*

---

## 🌑 Dark Mode

Dark mode is always **enabled by default**. Set using Tailwind's `darkMode: "class"` and applying `class="dark"` to `<html>`.

---

## 🔧 To Do

* [ ] Add username or emoji-based identity
* [ ] Introduce chat session expiration
* [ ] Add "typing..." indicator
* [ ] Add toast notifications
* [ ] Deploy frontend + backend

---

## 📄 License

This project is open-source and available under the [MIT License](LICENSE).

---

## 🙌 Acknowledgements

Built with ❤️ using Next.js, Tailwind, and Socket.IO

```

---

Let me know if you'd like to:
- Add screenshots or deployment links
- Mention your name/contributors
- Separate backend into a `/server` folder

Want it in `.md` file format? I can generate and send it to you directly.
```
