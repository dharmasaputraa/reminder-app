import { Nav } from "./sections/Nav";
import { Hero } from "./sections/Hero";

export default function App() {
  return (
    <>
      <Nav />
      <main id="top" className="pt-14">
        <Hero />
      </main>
    </>
  );
}
