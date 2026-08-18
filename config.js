/* THE COMMONS — where the archive keeps what it is given.
   ------------------------------------------------------------------------
   Fill these two in after you have run supabase/schema.sql. Both are meant to
   be public: the anon key is a published identifier, not a secret, and it can
   do nothing on its own — every write goes through an RPC that demands an
   invitation code, and the tables themselves are closed to it.

   Leave them empty and the piece still runs. It just opens on the founding
   archive alone, says so, and refuses contributions. */

window.COMMONS_CONFIG = {
  url: 'https://rmwrifnxujmwtzbfhkzq.supabase.co',
  anonKey: 'sb_publishable_g88RJUPz7QH_rFNedGkeRA_VOqXvfHs',

  // How many contributions to pull per request while the archive loads. The
  // cloud fills in as they arrive rather than waiting for the whole set.
  page: 24,

  // Seconds between checks for other people's contributions. 0 turns the
  // live update off and the piece only reads the archive once, at boot.
  poll: 45,
};
