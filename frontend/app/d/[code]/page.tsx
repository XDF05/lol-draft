import SpectatorView from '../../../components/draft/SpectatorView';

export default async function SpectatorRoute({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return <SpectatorView code={code.toUpperCase()} />;
}
