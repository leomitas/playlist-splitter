// Last.fm tag -> genre family. This is a whitelist: tags not listed here are ignored.
//
// How to add a mapping (see CONTRIBUTING.md):
// - Add the tag, in lowercase, to the family it belongs to. Spelling variations are welcome
//   ("hip-hop", "hip hop", "hiphop"); accented and unaccented forms are separate tags.
// - A tag must appear in only one family (the later one would win silently; a test checks it).
// - New family: add a key below and a color in app/genre-colors.ts (optional; families
//   without one get a stable color from their name).
// - Avoid tags that describe mood or era ("chill", "80s", "female vocalists"): they cross
//   genres and would pull unrelated tracks together.
// - Add a case to tests/classify.test.ts when the mapping fixes a real misclassification.

export const OTHER = "Outros";

export const GENRE_FAMILIES: Record<string, string[]> = {
  Rock: [
    "rock", "classic rock", "hard rock", "alternative rock", "alternative", "garage rock",
    "psychedelic rock", "progressive rock", "post-rock", "soft rock", "blues rock", "grunge",
    "britpop", "post-grunge", "stoner rock", "rock nacional", "brazilian rock", "pop rock",
    "art rock", "shoegaze", "dream pop", "noise rock", "math rock",
  ],
  Indie: [
    "indie", "indie rock", "indie pop", "indie folk", "indietronica", "indie pop rock",
    "twee pop", "jangle pop", "slowcore", "sadcore", "midwest emo", "emo", "art pop",
  ],
  Pop: [
    "pop", "dance pop", "electropop", "synthpop", "synth-pop", "teen pop", "k-pop", "j-pop",
    "c-pop", "latin pop", "pop latino", "power pop", "hyperpop", "chamber pop", "baroque pop",
    "europop", "bubblegum pop", "pop brasileiro", "reggaeton",
  ],
  "Hip-hop/Rap": [
    "hip-hop", "hip hop", "rap", "hiphop", "underground hip-hop", "conscious hip hop",
    "east coast hip hop", "west coast rap", "gangsta rap", "boom bap", "rap nacional",
    "brazilian hip hop", "hip hop brasileiro", "rap brasileiro", "alternative hip hop", "grime",
    "drill", "uk drill",
  ],
  Trap: ["trap", "trap brasileiro", "trap latino", "latin trap", "emo rap", "cloud rap", "rage"],
  // Brazilian funk only. The bare tag "funk" is deliberately NOT here: it's used both for
  // funk carioca and for American funk (Prince, Earth, Wind & Fire); see GENERIC_FUNK below.
  "Funk BR": [
    "brazilian funk", "funk carioca", "baile funk", "funk brasileiro", "funk paulista",
    "funk mandelao", "funk mandelão", "funk ostentacao", "funk ostentação", "funk melody",
    "funk consciente", "automotivo", "funk automotivo",
  ],
  "Pagode/Samba": ["pagode", "samba", "samba-enredo", "samba enredo", "partido alto", "samba rock"],
  Sertanejo: [
    "sertanejo", "sertanejo universitario", "sertanejo universitário", "sertanejo raiz",
    "modao", "modão", "arrocha", "piseiro", "pisadinha", "forro", "forró", "brega", "brega funk", "axe", "axé",
  ],
  "R&B/Soul": [
    "rnb", "r&b", "r and b", "soul", "neo-soul", "neo soul", "contemporary r&b", "alternative rnb",
    "alternative r&b", "motown", "funk soul", "gospel", "p-funk",
  ],
  "Eletrônica": [
    "electronic", "electronica", "edm", "house", "deep house", "tech house", "techno", "trance",
    "dubstep", "drum and bass", "dnb", "electro", "electro house", "progressive house",
    "future bass", "ambient", "idm", "uk garage", "breakbeat", "downtempo", "trip-hop",
    "trip hop", "synthwave", "dance", "disco", "nu disco",
  ],
  Metal: [
    "metal", "heavy metal", "thrash metal", "death metal", "black metal", "doom metal",
    "power metal", "progressive metal", "metalcore", "nu metal", "nu-metal", "speed metal",
    "symphonic metal", "deathcore", "djent", "sludge metal", "alternative metal",
  ],
  Punk: [
    "punk", "punk rock", "pop punk", "pop-punk", "hardcore", "hardcore punk", "post-punk",
    "skate punk", "ska punk", "emo punk", "post-hardcore", "riot grrrl",
  ],
  Folk: [
    "folk", "folk rock", "acoustic", "singer-songwriter", "americana", "country", "bluegrass",
    "alt-country", "freak folk", "chamber folk", "contemporary folk",
  ],
  Jazz: [
    "jazz", "smooth jazz", "jazz fusion", "bebop", "swing", "vocal jazz", "acid jazz",
    "nu jazz", "blues", "big band",
  ],
  MPB: [
    "mpb", "musica popular brasileira", "música popular brasileira", "bossa nova", "tropicalia",
    "tropicália", "nova mpb", "musica brasileira", "música brasileira",
  ],
  "Lo-fi/Bedroom": [
    "lo-fi", "lofi", "lo fi", "bedroom pop", "chillhop", "lofi hip hop", "lo-fi hip hop",
    "chillwave",
  ],
  Phonk: ["phonk", "drift phonk", "brazilian phonk", "memphis rap", "memphis phonk"],
};

// The bare "funk" tag has no family of its own; where it goes depends on the artist:
// - the track also has a Funk BR tag, or the artist is from Brazil (MusicBrainz) -> Funk BR
// - the artist is from another country -> GRINGO_FUNK (it then competes with the other tags,
//   so a jazz-heavy artist still ends up in Jazz)
// - country unknown -> FUNK_UNCERTAIN, shown as its own group for review
export const GENERIC_FUNK = "funk";
export const FUNK_BR = "Funk BR";
export const GRINGO_FUNK = "R&B/Soul";
export const FUNK_UNCERTAIN = "Funk (incerto)";

// Families that mean "not decided": they don't vote in the artist consensus and can receive
// a family from it, like "Outros"
export const UNCERTAIN_FAMILIES = new Set([OTHER, FUNK_UNCERTAIN]);

// Reverse index: tag -> family
export const TAG_TO_FAMILY = new Map<string, string>(
  Object.entries(GENRE_FAMILIES).flatMap(([family, tags]) => tags.map((t) => [t, family])),
);
