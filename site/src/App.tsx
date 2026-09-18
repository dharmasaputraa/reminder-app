import { Nav } from "./sections/Nav";
import { Hero } from "./sections/Hero";
import { Features } from "./sections/Features";

export default function App() {
  return (
    <>
      <Nav />
      <main id="top" className="pt-14">
        <Hero />
        <Features />
      </main>
    </>
  );
}
