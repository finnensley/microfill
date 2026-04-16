interface LogoutButtonProps {
  className?: string;
}

export function LogoutButton({ className }: LogoutButtonProps) {
  return (
    <form action="/auth/logout" method="post">
      <button
        type="submit"
        className={
          className ??
          "rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:text-slate-950"
        }
      >
        Sign out
      </button>
    </form>
  );
}
