// Last.fm tag -> genre family. This is a whitelist: tags not listed here are ignored.
// Tags are compared in lowercase; add variations freely.

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
  Funk: [
    "funk", "funk carioca", "baile funk", "funk brasileiro", "brazilian funk", "funk ostentacao",
    "funk ostentação", "funk paulista", "funk mandelao", "funk mandelão", "p-funk",
  ],
  "Pagode/Samba": ["pagode", "samba", "samba-enredo", "samba enredo", "partido alto", "samba rock"],
  Sertanejo: [
    "sertanejo", "sertanejo universitario", "sertanejo universitário", "sertanejo raiz",
    "modao", "modão", "arrocha", "piseiro", "pisadinha", "forro", "forró", "brega", "brega funk", "axe", "axé",
  ],
  "R&B/Soul": [
    "rnb", "r&b", "r and b", "soul", "neo-soul", "neo soul", "contemporary r&b", "alternative rnb",
    "alternative r&b", "motown", "funk soul", "gospel",
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

// Reverse index: tag -> family
export const TAG_TO_FAMILY = new Map<string, string>(
  Object.entries(GENRE_FAMILIES).flatMap(([family, tags]) => tags.map((t) => [t, family])),
);
