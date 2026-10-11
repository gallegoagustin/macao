import { HomeForm } from "@/components/HomeForm";
import { PlayingCard } from "@/components/PlayingCard";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center gap-10 px-5 py-10">
      <header className="relative text-center">
        <div className="pointer-events-none mx-auto mb-2 flex h-28 w-48 items-end justify-center" aria-hidden="true">
          <div className="-mr-8 w-20 -rotate-[14deg] origin-bottom"><PlayingCard id="KH" /></div>
          <div className="z-10 w-20 -translate-y-2"><PlayingCard id="AS" /></div>
          <div className="-ml-8 w-20 rotate-[14deg] origin-bottom"><PlayingCard id="QD" /></div>
        </div>
        <h1 className="font-display text-7xl font-black tracking-tight text-brass-soft [font-variation-settings:'SOFT'_100] sm:text-8xl">
          Macao
        </h1>
        <p className="mt-2 text-lg text-cream/75">Cartas con amigos. Sin cuentas, sin complicaciones.</p>
      </header>
      <HomeForm />
    </main>
  );
}
