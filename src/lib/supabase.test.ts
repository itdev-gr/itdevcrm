describe('supabase client', () => {
  it('exports a client with auth, from, and storage namespaces', async () => {
    const mod = await import('./supabase');
    expect(mod.supabase).toBeDefined();
    expect(typeof mod.supabase.auth.getSession).toBe('function');
    expect(typeof mod.supabase.from).toBe('function');
    expect(mod.supabase.storage).toBeDefined();
  });
});
