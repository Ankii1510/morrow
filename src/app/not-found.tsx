import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center p-6 text-center">
      <div>
        <p className="display text-3xl">That page does not exist.</p>
        <Link href="/library" className="btn btn-quiet mt-6">
          Go to your library
        </Link>
      </div>
    </main>
  );
}
