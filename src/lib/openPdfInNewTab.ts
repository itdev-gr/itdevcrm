/**
 * Open a tab synchronously — inside the click gesture — so the browser's
 * popup blocker doesn't kill it after the multi-second PDF render, then
 * point the already-open tab at the signed URL.
 */
export async function openPdfInNewTab(generate: () => Promise<string>): Promise<void> {
  const tab = window.open('', '_blank');
  if (tab) tab.document.write('Generating PDF…');
  try {
    const url = await generate();
    if (tab) tab.location.href = url;
    else window.location.href = url; // popup blocked anyway → use current tab
  } catch (err) {
    tab?.close();
    alert((err as Error).message);
  }
}
