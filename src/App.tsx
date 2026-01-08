import { useEffect } from "react";
import { Header } from "./components/Header";
import { Hero } from "./components/Hero";
import { Calendar } from "./components/Calendar";
import { client } from "./lib/appwrite";

function App() {
  useEffect(() => {
    client.ping().then(response => {
      console.log("Appwrite connection verified:", response);
    }).catch(error => {
      console.error("Appwrite connection failed:", error);
    });
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground font-sans selection:bg-indigo-500/30 selection:text-indigo-600">
      <Header />
      <main>
        <Hero />
        <Calendar />
      </main>

      {/* Simple Footer */}
      <footer className="border-t border-white/10 py-12 bg-background">
        <div className="container mx-auto px-6 text-center text-sm text-muted-foreground">
          <p>© 2026 SG Holiday Optimizer. Vibe-coded by Goh Han Long, Eugene.</p>
        </div>
      </footer>
    </div>
  );
}

export default App;
