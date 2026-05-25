type SectionHeaderProps = {
  eyebrow: string;
  title: string;
  description: string;
};

export function SectionHeader({ eyebrow, title, description }: SectionHeaderProps) {
  return (
    <div className="mx-auto mb-12 max-w-3xl text-center">
      <p className="mb-4 text-xs font-semibold uppercase tracking-[0.3em] text-kcx-orange">{eyebrow}</p>
      <h2 className="text-3xl font-semibold leading-tight text-white sm:text-4xl lg:text-5xl">{title}</h2>
      <p className="mx-auto mt-5 max-w-2xl text-base leading-8 text-kcx-ash">{description}</p>
    </div>
  );
}
