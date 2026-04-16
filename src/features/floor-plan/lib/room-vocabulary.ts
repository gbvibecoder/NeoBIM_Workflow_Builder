export type RoomFunction =
  | "bedroom" | "master_bedroom" | "guest_bedroom" | "kids_bedroom"
  | "living" | "dining" | "kitchen"
  | "bathroom" | "master_bathroom" | "powder_room"
  | "walk_in_wardrobe" | "walk_in_closet"
  | "foyer" | "porch" | "verandah" | "balcony" | "corridor" | "staircase"
  | "utility" | "store" | "pooja" | "study" | "servant_quarter" | "other";

export interface SurfaceForm {
  text: string;
  requires_word_boundary: boolean;
}

export interface FunctionVocabulary {
  function: RoomFunction;
  surface_forms: SurfaceForm[];
}

const wb = (text: string): SurfaceForm => ({ text, requires_word_boundary: true });
const sub = (text: string): SurfaceForm => ({ text, requires_word_boundary: false });

export const ROOM_VOCABULARY: FunctionVocabulary[] = [
  {
    function: "master_bedroom",
    surface_forms: [
      sub("master bedroom"), sub("master bed"), sub("master br"), sub("master suite"),
      sub("primary bedroom"), sub("primary suite"), sub("main bedroom"), sub("owners suite"),
      sub("owner's bedroom"), sub("owner suite"), wb("mbr"), wb("mbed"),
      wb("master"), sub("master southwest"), sub("master sw"),
    ],
  },
  {
    function: "bedroom",
    surface_forms: [
      sub("bedroom"), sub("bed room"), sub("bedrm"), sub("guest bed"),
      wb("br"), wb("bed"), wb("b1"), wb("b2"), wb("b3"), wb("b4"), wb("b5"),
      sub("bhk"),
    ],
  },
  {
    function: "guest_bedroom",
    surface_forms: [
      sub("guest bedroom"), sub("guest bed"), sub("guest room"), sub("visitor bedroom"),
      sub("visitor room"), sub("guest suite"),
    ],
  },
  {
    function: "kids_bedroom",
    surface_forms: [
      sub("kids bedroom"), sub("kids bed"), sub("kid bedroom"), sub("kids room"),
      sub("childrens bedroom"), sub("children's bedroom"), sub("nursery"), sub("child room"),
    ],
  },
  {
    function: "living",
    surface_forms: [
      sub("living room"), sub("living"), sub("drawing room"), sub("drawing"),
      sub("hall"), sub("lounge"), sub("sitting room"), sub("family room"),
      wb("lr"), wb("lvg"), wb("lvr"),
    ],
  },
  {
    function: "dining",
    surface_forms: [
      sub("dining room"), sub("dining area"), sub("dining"), sub("eating area"),
      sub("breakfast nook"), wb("dr"), wb("dine"),
    ],
  },
  {
    function: "kitchen",
    surface_forms: [
      sub("kitchen"), sub("kitchenette"), sub("modular kitchen"), sub("open kitchen"),
      sub("wet kitchen"), sub("dry kitchen"), wb("kit"), wb("kitch"),
    ],
  },
  {
    function: "bathroom",
    surface_forms: [
      sub("bathroom"), sub("bath room"), sub("bath"), sub("toilet"), sub("washroom"),
      sub("ensuite"), sub("attached bath"), sub("common bath"), sub("shared bath"),
      wb("wc"), wb("ba"), wb("loo"), sub("shower room"),
    ],
  },
  {
    function: "master_bathroom",
    surface_forms: [
      sub("master bathroom"), sub("master bath"), sub("master ensuite"),
      sub("primary bath"), sub("primary bathroom"), sub("master toilet"),
      sub("ensuite bathroom"), sub("ensuite bath"), sub("attached bathroom"),
      sub("attached bath"),
    ],
  },
  {
    function: "powder_room",
    surface_forms: [
      sub("powder room"), sub("powder"), sub("half bath"), sub("guest toilet"),
      sub("guest wc"), sub("guest washroom"), sub("visitor toilet"),
    ],
  },
  {
    function: "walk_in_wardrobe",
    surface_forms: [
      sub("walk-in wardrobe"), sub("walk in wardrobe"), sub("walkin wardrobe"),
      sub("wardrobe"), sub("almirah"), sub("dressing room"),
      wb("wiw"),
    ],
  },
  {
    function: "walk_in_closet",
    surface_forms: [
      sub("walk-in closet"), sub("walk in closet"), sub("walkin closet"),
      sub("closet"), wb("wic"),
    ],
  },
  {
    function: "foyer",
    surface_forms: [
      sub("foyer"), sub("entrance hall"), sub("entrance area"), sub("entry hall"),
      sub("entry"), sub("entrance lobby"), sub("vestibule"),
    ],
  },
  {
    function: "porch",
    surface_forms: [
      sub("porch"), sub("portico"), sub("entry porch"), sub("front porch"),
      sub("car porch"),
    ],
  },
  {
    function: "verandah",
    surface_forms: [
      sub("verandah"), sub("veranda"), sub("sit-out"), sub("sit out"), sub("sitout"),
      sub("baradari"), sub("covered porch"),
    ],
  },
  {
    function: "balcony",
    surface_forms: [
      sub("balcony"), sub("juliet balcony"), sub("master balcony"), sub("private balcony"),
      sub("utility balcony"), sub("drying balcony"), wb("bal"),
    ],
  },
  {
    function: "corridor",
    surface_forms: [
      sub("corridor"), sub("hallway"), sub("hall way"), sub("passage"), sub("passageway"),
      wb("corr"), wb("hall"),
    ],
  },
  {
    function: "staircase",
    surface_forms: [
      sub("staircase"), sub("stair case"), sub("stairs"), sub("internal staircase"),
      sub("stairwell"), wb("stair"),
    ],
  },
  {
    function: "utility",
    surface_forms: [
      sub("utility room"), sub("utility area"), sub("utility"), sub("laundry"),
      sub("laundry room"), sub("wash area"), sub("washing area"), sub("dhobi"),
      sub("service area"), wb("ut"),
    ],
  },
  {
    function: "store",
    surface_forms: [
      sub("store room"), sub("storeroom"), sub("storage"), sub("storage room"),
      sub("store"), sub("pantry"), sub("larder"),
    ],
  },
  {
    function: "pooja",
    surface_forms: [
      sub("pooja room"), sub("pooja"), sub("puja room"), sub("puja"),
      sub("prayer room"), sub("prayer"), sub("mandir"), sub("temple room"),
      sub("altar room"), sub("shrine"), sub("meditation room"),
    ],
  },
  {
    function: "study",
    surface_forms: [
      sub("study room"), sub("study"), sub("home office"), sub("office room"),
      sub("library"), sub("reading room"), sub("workspace"), sub("den"),
    ],
  },
  {
    function: "servant_quarter",
    surface_forms: [
      sub("servant quarter"), sub("servant room"), sub("servant's quarter"),
      sub("servants room"), sub("servants quarter"), sub("maids room"),
      sub("maid's room"), sub("staff quarter"), sub("help quarter"),
    ],
  },
  {
    function: "other",
    surface_forms: [
      sub("home theater"), sub("home theatre"), sub("theater"), sub("theatre"),
      sub("gym"), sub("fitness room"), sub("workout room"), sub("yoga room"),
      sub("game room"), sub("garage"), sub("car parking"), sub("parking"),
      sub("courtyard"), sub("terrace"), sub("garden"), sub("swimming pool"),
      sub("pool"), sub("bar"), sub("mini bar"), sub("breakfast bar"),
      sub("shoe rack"), sub("shoe cabinet"), sub("coat closet"),
      sub("linen storage"), sub("linen closet"),
    ],
  },
];

export function getSurfaceForms(fn: RoomFunction): SurfaceForm[] {
  return ROOM_VOCABULARY.find(v => v.function === fn)?.surface_forms ?? [];
}

export function allFunctions(): RoomFunction[] {
  return ROOM_VOCABULARY.map(v => v.function);
}
