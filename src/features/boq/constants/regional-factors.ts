/**
 * Regional cost factors, exchange rates, and city tiers for BOQ pricing.
 * All factors are relative to US baseline (1.0).
 * Exchange rates are static reference rates (USD base) — update periodically.
 */

// ─── Country Cost Factors ────────────────────────────────────────────────────

export interface CountryFactor {
  country: string;
  code: string;
  factor: number;        // relative to US baseline
  currency: string;      // ISO 4217 code
  currencySymbol: string;
  exchangeRate: number;  // 1 USD = X local currency
}

// Indian-only product (Phase B). Non-India entries removed.
// India entry kept for resolveProjectLocation() fallback.
export const COUNTRY_FACTORS: CountryFactor[] = [
  { country: "India",         code: "IN", factor: 1.00, currency: "INR", currencySymbol: "₹",  exchangeRate: 1.00 },
];

// ─── City Tier Factors ───────────────────────────────────────────────────────

export type CityTier = "metro" | "city" | "town" | "rural";

export const CITY_TIER_FACTORS: Record<CityTier, { factor: number; label: string }> = {
  metro: { factor: 1.15, label: "Tier 1 Metro" },
  city:  { factor: 0.95, label: "Tier 2 City" },
  town:  { factor: 0.80, label: "Tier 3 Town" },
  rural: { factor: 0.70, label: "Rural" },
};

// Known metros by country (for auto-detection from city name)
const KNOWN_METROS: Record<string, string[]> = {
  US: ["New York", "San Francisco", "Los Angeles", "Chicago", "Boston", "Seattle", "Miami", "Washington"],
  IN: ["Mumbai", "Delhi", "Bangalore", "Bengaluru", "Chennai", "Hyderabad", "Kolkata"],
  GB: ["London", "Manchester", "Birmingham"],
  AE: ["Dubai", "Abu Dhabi"],
  AU: ["Sydney", "Melbourne"],
  CA: ["Toronto", "Vancouver"],
  DE: ["Berlin", "Munich", "Frankfurt", "Hamburg"],
  JP: ["Tokyo", "Osaka"],
  CN: ["Shanghai", "Beijing", "Shenzhen", "Guangzhou"],
  SG: ["Singapore"],
  SA: ["Riyadh", "Jeddah"],
  BR: ["São Paulo", "Rio de Janeiro"],
};

const KNOWN_CITIES: Record<string, string[]> = {
  US: ["Austin", "Denver", "Portland", "Nashville", "Phoenix", "Atlanta", "Houston", "Dallas"],
  IN: ["Pune", "Ahmedabad", "Jaipur", "Lucknow", "Chandigarh", "Kochi", "Indore", "Nagpur", "Surat", "Vadodara"],
  GB: ["Leeds", "Bristol", "Edinburgh", "Glasgow", "Liverpool"],
  AE: ["Sharjah", "Ajman"],
  AU: ["Brisbane", "Perth", "Adelaide"],
  CA: ["Montreal", "Calgary", "Ottawa"],
  DE: ["Stuttgart", "Düsseldorf", "Cologne"],
  SA: ["Dammam", "Medina"],
};

/**
 * Detect city tier from city name and country code.
 */
export function detectCityTier(city: string, countryCode: string): CityTier {
  if (!city) return "city";
  const normalized = city.trim().toLowerCase();

  const metros = KNOWN_METROS[countryCode] || [];
  if (metros.some(m => normalized.includes(m.toLowerCase()))) return "metro";

  const cities = KNOWN_CITIES[countryCode] || [];
  if (cities.some(c => normalized.includes(c.toLowerCase()))) return "city";

  // If city name is provided but not in our lists, assume tier 2
  return "city";
}

// ─── State/Region Lists (for UI dropdowns) ───────────────────────────────────

export const STATES_BY_COUNTRY: Record<string, string[]> = {
  US: ["Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut", "Delaware", "Florida", "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey", "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota", "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington", "West Virginia", "Wisconsin", "Wyoming"],
  IN: ["Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal", "Delhi NCR"],
  GB: ["England", "Scotland", "Wales", "Northern Ireland"],
  AE: ["Abu Dhabi", "Dubai", "Sharjah", "Ajman", "Umm Al Quwain", "Ras Al Khaimah", "Fujairah"],
  AU: ["New South Wales", "Victoria", "Queensland", "Western Australia", "South Australia", "Tasmania", "ACT", "Northern Territory"],
  CA: ["Ontario", "Quebec", "British Columbia", "Alberta", "Manitoba", "Saskatchewan", "Nova Scotia", "New Brunswick"],
  DE: ["Baden-Württemberg", "Bavaria", "Berlin", "Brandenburg", "Bremen", "Hamburg", "Hesse", "Lower Saxony", "Mecklenburg-Vorpommern", "North Rhine-Westphalia", "Rhineland-Palatinate", "Saarland", "Saxony", "Saxony-Anhalt", "Schleswig-Holstein", "Thuringia"],
  SA: ["Riyadh", "Makkah", "Eastern Province", "Madinah", "Asir", "Jazan", "Tabuk"],
};

// ─── Cities by State/Region (for cascading dropdowns) ────────────────────────
// Countries without states list cities directly under country code

export const CITIES_BY_STATE: Record<string, Record<string, string[]>> = {
  US: {
    "California": ["Los Angeles", "San Francisco", "San Diego", "San Jose", "Sacramento", "Fresno", "Oakland"],
    "New York": ["New York City", "Buffalo", "Rochester", "Albany", "Syracuse"],
    "Texas": ["Houston", "Dallas", "Austin", "San Antonio", "Fort Worth", "El Paso"],
    "Florida": ["Miami", "Orlando", "Tampa", "Jacksonville", "Fort Lauderdale"],
    "Illinois": ["Chicago", "Springfield", "Naperville", "Rockford"],
    "Pennsylvania": ["Philadelphia", "Pittsburgh", "Allentown", "Erie"],
    "Ohio": ["Columbus", "Cleveland", "Cincinnati", "Toledo"],
    "Georgia": ["Atlanta", "Savannah", "Augusta"],
    "Washington": ["Seattle", "Tacoma", "Spokane", "Bellevue"],
    "Massachusetts": ["Boston", "Cambridge", "Worcester", "Springfield"],
    "Colorado": ["Denver", "Colorado Springs", "Aurora", "Boulder"],
    "Arizona": ["Phoenix", "Tucson", "Mesa", "Scottsdale"],
    "Michigan": ["Detroit", "Grand Rapids", "Ann Arbor"],
    "Nevada": ["Las Vegas", "Reno", "Henderson"],
    "Oregon": ["Portland", "Salem", "Eugene"],
    "Tennessee": ["Nashville", "Memphis", "Knoxville", "Chattanooga"],
    "North Carolina": ["Charlotte", "Raleigh", "Durham", "Greensboro"],
    "Virginia": ["Virginia Beach", "Richmond", "Norfolk", "Arlington"],
    "Maryland": ["Baltimore", "Bethesda", "Rockville"],
    "Minnesota": ["Minneapolis", "Saint Paul", "Rochester"],
    "Missouri": ["Kansas City", "St. Louis", "Springfield"],
    "Indiana": ["Indianapolis", "Fort Wayne", "Evansville"],
    "Wisconsin": ["Milwaukee", "Madison", "Green Bay"],
    "Connecticut": ["Hartford", "New Haven", "Stamford"],
    "New Jersey": ["Newark", "Jersey City", "Trenton", "Princeton"],
  },
  IN: {
    "Maharashtra": ["Mumbai", "Pune", "Nagpur", "Nashik", "Thane", "Aurangabad (Chhatrapati Sambhajinagar)", "Solapur", "Kolhapur", "Sangli", "Navi Mumbai", "Amravati", "Akola", "Latur", "Jalgaon", "Dhule", "Ahmednagar", "Chandrapur", "Parbhani", "Jalna", "Bhiwandi", "Panvel", "Satara", "Beed", "Ratnagiri", "Osmanabad (Dharashiv)", "Nanded", "Yavatmal", "Wardha", "Gondia", "Buldhana", "Washim", "Hingoli", "Sindhudurg", "Kalyan", "Dombivli", "Mira-Bhayandar", "Vasai-Virar", "Malegaon", "Ichalkaranji", "Pimpri-Chinchwad", "Ulhasnagar", "Ambernath", "Badlapur"],
    "Karnataka": ["Bangalore (Bengaluru)", "Mysore (Mysuru)", "Hubli-Dharwad", "Mangalore (Mangaluru)", "Belgaum (Belagavi)", "Shimoga (Shivamogga)", "Davangere", "Bellary (Ballari)", "Gulbarga (Kalaburagi)", "Raichur", "Bijapur (Vijayapura)", "Tumkur (Tumakuru)", "Hassan", "Udupi", "Chitradurga", "Mandya", "Kolar", "Bagalkot", "Gadag", "Haveri", "Karwar"],
    "Tamil Nadu": ["Chennai", "Coimbatore", "Madurai", "Tiruchirappalli (Trichy)", "Salem", "Erode", "Tirunelveli", "Vellore", "Thanjavur", "Thoothukudi (Tuticorin)", "Dindigul", "Cuddalore", "Kanchipuram", "Nagercoil", "Tirupur", "Hosur", "Kumbakonam", "Karur", "Sivakasi", "Namakkal", "Ambur"],
    "Telangana": ["Hyderabad", "Warangal", "Nizamabad", "Karimnagar", "Khammam", "Mahbubnagar", "Nalgonda", "Adilabad", "Secunderabad", "Ramagundam", "Siddipet", "Miryalaguda", "Mancherial"],
    "Gujarat": ["Ahmedabad", "Surat", "Vadodara (Baroda)", "Rajkot", "Bhavnagar", "Gandhinagar", "Jamnagar", "Junagadh", "Anand", "Nadiad", "Morbi", "Mehsana", "Bharuch", "Navsari", "Valsad", "Porbandar", "Godhra", "Veraval", "Palanpur", "Dahod", "Surendranagar"],
    "Rajasthan": ["Jaipur", "Jodhpur", "Udaipur", "Kota", "Ajmer", "Bikaner", "Alwar", "Bharatpur", "Pali", "Sikar", "Sri Ganganagar", "Bhilwara", "Tonk", "Kishangarh", "Beawar", "Chittorgarh", "Barmer", "Jaisalmer", "Nagaur", "Jhunjhunu", "Sawai Madhopur", "Bundi", "Hanumangarh", "Dausa"],
    "West Bengal": ["Kolkata", "Howrah", "Durgapur", "Asansol", "Siliguri", "Bardhaman (Burdwan)", "Malda", "Baharampur", "Habra", "Kharagpur", "Shantiniketan", "Darjeeling", "Jalpaiguri", "Cooch Behar", "Haldia", "Bankura", "Purulia", "Raiganj", "Krishnanagar", "Balurghat", "Basirhat", "Kalyani"],
    "Uttar Pradesh": ["Lucknow", "Noida", "Agra", "Varanasi", "Kanpur", "Ghaziabad", "Meerut", "Prayagraj (Allahabad)", "Bareilly", "Aligarh", "Moradabad", "Saharanpur", "Gorakhpur", "Firozabad", "Jhansi", "Muzaffarnagar", "Mathura", "Ayodhya", "Shahjahanpur", "Rampur", "Sambhal", "Amroha", "Budaun", "Etawah", "Hapur", "Greater Noida", "Unnao"],
    "Kerala": ["Kochi (Cochin)", "Thiruvananthapuram (Trivandrum)", "Kozhikode (Calicut)", "Thrissur", "Kollam (Quilon)", "Palakkad", "Alappuzha (Alleppey)", "Kannur", "Kottayam", "Malappuram", "Thodupuzha", "Kasaragod", "Pathanamthitta", "Idukki", "Wayanad", "Munnar"],
    "Madhya Pradesh": ["Bhopal", "Indore", "Gwalior", "Jabalpur", "Ujjain", "Sagar", "Dewas", "Satna", "Ratlam", "Rewa", "Singrauli", "Burhanpur", "Khandwa", "Bhind", "Chhindwara", "Morena", "Shivpuri", "Vidisha", "Damoh"],
    "Punjab": ["Chandigarh", "Ludhiana", "Amritsar", "Jalandhar", "Patiala", "Bathinda", "Mohali (SAS Nagar)", "Pathankot", "Hoshiarpur", "Moga", "Batala", "Phagwara", "Firozpur", "Kapurthala", "Sangrur", "Muktsar", "Barnala", "Nawanshahr"],
    "Haryana": ["Gurugram (Gurgaon)", "Faridabad", "Panipat", "Ambala", "Karnal", "Hisar", "Rohtak", "Sonipat", "Yamunanagar", "Panchkula", "Bhiwani", "Sirsa", "Rewari", "Jind", "Palwal", "Kaithal", "Kurukshetra", "Bahadurgarh", "Manesar"],
    "Bihar": ["Patna", "Gaya", "Muzaffarpur", "Bhagalpur", "Darbhanga", "Purnia", "Arrah", "Begusarai", "Katihar", "Munger", "Chhapra", "Saharsa", "Sasaram", "Hajipur", "Dehri", "Bihar Sharif", "Sitamarhi", "Siwan", "Bettiah", "Motihari"],
    "Odisha": ["Bhubaneswar", "Cuttack", "Rourkela", "Berhampur (Brahmapur)", "Sambalpur", "Puri", "Balasore", "Bhadrak", "Baripada", "Jharsuguda", "Jeypore", "Barbil", "Koraput", "Paradip", "Angul", "Dhenkanal"],
    "Jharkhand": ["Ranchi", "Jamshedpur", "Dhanbad", "Bokaro Steel City", "Deoghar", "Hazaribagh", "Giridih", "Ramgarh", "Medininagar (Daltonganj)", "Dumka", "Phusro", "Chaibasa"],
    "Chhattisgarh": ["Raipur", "Bhilai", "Bilaspur", "Korba", "Durg", "Rajnandgaon", "Raigarh", "Jagdalpur", "Ambikapur", "Dhamtari", "Mahasamund", "Chirmiri"],
    "Goa": ["Panaji", "Margao (Madgaon)", "Vasco da Gama", "Mapusa", "Ponda", "Bicholim", "Curchorem", "Sanquelim", "Cuncolim", "Quepem"],
    "Delhi NCR": ["New Delhi", "Central Delhi", "South Delhi", "North Delhi", "East Delhi", "West Delhi", "Dwarka", "Rohini", "Saket", "Connaught Place", "Lajpat Nagar", "Karol Bagh"],
    "Andhra Pradesh": ["Visakhapatnam (Vizag)", "Vijayawada", "Guntur", "Tirupati", "Nellore", "Kurnool", "Kakinada", "Rajahmundry", "Kadapa", "Anantapur", "Eluru", "Ongole", "Vizianagaram", "Srikakulam", "Tenali", "Proddatur", "Chittoor", "Hindupur", "Machilipatnam", "Amaravati"],
    "Himachal Pradesh": ["Shimla", "Dharamshala", "Manali", "Kullu", "Solan", "Mandi", "Palampur", "Nahan", "Hamirpur", "Bilaspur", "Chamba", "Una", "Kangra", "Keylong"],
    "Uttarakhand": ["Dehradun", "Haridwar", "Rishikesh", "Roorkee", "Haldwani", "Kashipur", "Rudrapur", "Nainital", "Mussoorie", "Almora", "Pithoragarh", "Kotdwar", "Ramnagar", "Pauri"],
    "Assam": ["Guwahati", "Silchar", "Dibrugarh", "Jorhat", "Nagaon", "Tinsukia", "Tezpur", "Bongaigaon", "Barpeta"],
    "Sikkim": ["Gangtok", "Namchi", "Gyalshing", "Mangan"],
    "Meghalaya": ["Shillong", "Tura", "Jowai", "Nongstoin"],
    "Manipur": ["Imphal", "Thoubal", "Bishnupur", "Churachandpur"],
    "Mizoram": ["Aizawl", "Lunglei", "Champhai", "Serchhip"],
    "Nagaland": ["Kohima", "Dimapur", "Mokokchung", "Tuensang", "Wokha"],
    "Tripura": ["Agartala", "Udaipur", "Dharmanagar", "Kailasahar"],
    "Arunachal Pradesh": ["Itanagar", "Naharlagun", "Pasighat", "Tawang"],
  },
  GB: {
    "England": ["London", "Manchester", "Birmingham", "Leeds", "Liverpool", "Bristol", "Sheffield", "Newcastle", "Nottingham", "Southampton"],
    "Scotland": ["Edinburgh", "Glasgow", "Aberdeen", "Dundee", "Inverness"],
    "Wales": ["Cardiff", "Swansea", "Newport", "Wrexham"],
    "Northern Ireland": ["Belfast", "Derry", "Lisburn", "Newry"],
  },
  AE: {
    "Abu Dhabi": ["Abu Dhabi City", "Al Ain", "Madinat Zayed"],
    "Dubai": ["Dubai City", "Jebel Ali", "Dubai Marina", "Downtown Dubai"],
    "Sharjah": ["Sharjah City", "Kalba", "Khor Fakkan"],
    "Ajman": ["Ajman City", "Masfout"],
    "Ras Al Khaimah": ["RAK City", "Al Jazirah Al Hamra"],
    "Fujairah": ["Fujairah City", "Dibba Al-Fujairah"],
  },
  AU: {
    "New South Wales": ["Sydney", "Newcastle", "Wollongong", "Central Coast"],
    "Victoria": ["Melbourne", "Geelong", "Ballarat", "Bendigo"],
    "Queensland": ["Brisbane", "Gold Coast", "Sunshine Coast", "Cairns", "Townsville"],
    "Western Australia": ["Perth", "Fremantle", "Bunbury", "Geraldton"],
    "South Australia": ["Adelaide", "Mount Gambier", "Whyalla"],
    "Tasmania": ["Hobart", "Launceston", "Devonport"],
    "ACT": ["Canberra"],
    "Northern Territory": ["Darwin", "Alice Springs"],
  },
  CA: {
    "Ontario": ["Toronto", "Ottawa", "Mississauga", "Hamilton", "London", "Kitchener"],
    "Quebec": ["Montreal", "Quebec City", "Laval", "Gatineau"],
    "British Columbia": ["Vancouver", "Victoria", "Surrey", "Burnaby", "Kelowna"],
    "Alberta": ["Calgary", "Edmonton", "Red Deer", "Lethbridge"],
    "Manitoba": ["Winnipeg", "Brandon"],
    "Saskatchewan": ["Saskatoon", "Regina"],
    "Nova Scotia": ["Halifax", "Sydney"],
    "New Brunswick": ["Fredericton", "Saint John", "Moncton"],
  },
  DE: {
    "Bavaria": ["Munich", "Nuremberg", "Augsburg", "Regensburg"],
    "Berlin": ["Berlin"],
    "Hamburg": ["Hamburg"],
    "Hesse": ["Frankfurt", "Wiesbaden", "Kassel", "Darmstadt"],
    "Baden-Württemberg": ["Stuttgart", "Mannheim", "Karlsruhe", "Freiburg", "Heidelberg"],
    "North Rhine-Westphalia": ["Cologne", "Düsseldorf", "Dortmund", "Essen", "Bonn"],
    "Lower Saxony": ["Hanover", "Brunswick", "Oldenburg", "Osnabrück"],
    "Saxony": ["Dresden", "Leipzig", "Chemnitz"],
    "Brandenburg": ["Potsdam", "Cottbus", "Frankfurt (Oder)"],
    "Bremen": ["Bremen", "Bremerhaven"],
  },
  SA: {
    "Riyadh": ["Riyadh City", "Al Kharj", "Dawadmi"],
    "Makkah": ["Jeddah", "Makkah City", "Taif"],
    "Eastern Province": ["Dammam", "Al Khobar", "Dhahran", "Jubail"],
    "Madinah": ["Madinah City", "Yanbu"],
    "Asir": ["Abha", "Khamis Mushait"],
    "Tabuk": ["Tabuk City"],
  },
  SG: {}, // Singapore has no states — city dropdown shows directly
  JP: {},
  CN: {},
  KR: {},
  BR: {},
  FR: {},
  MX: {},
  QA: {},
  NG: {},
  ZA: {},
  NL: {},
};

// Direct city lists for countries without state subdivision
export const CITIES_DIRECT: Record<string, string[]> = {
  SG: ["Singapore"],
  JP: ["Tokyo", "Osaka", "Yokohama", "Nagoya", "Sapporo", "Kobe", "Kyoto", "Fukuoka"],
  CN: ["Shanghai", "Beijing", "Shenzhen", "Guangzhou", "Chengdu", "Hangzhou", "Wuhan", "Nanjing", "Chongqing", "Tianjin"],
  KR: ["Seoul", "Busan", "Incheon", "Daegu", "Daejeon", "Gwangju", "Ulsan"],
  BR: ["São Paulo", "Rio de Janeiro", "Brasília", "Salvador", "Fortaleza", "Belo Horizonte", "Manaus", "Curitiba"],
  FR: ["Paris", "Marseille", "Lyon", "Toulouse", "Nice", "Nantes", "Strasbourg", "Bordeaux", "Lille"],
  MX: ["Mexico City", "Guadalajara", "Monterrey", "Puebla", "Tijuana", "León", "Cancún"],
  QA: ["Doha", "Al Wakrah", "Al Khor", "Lusail"],
  NG: ["Lagos", "Abuja", "Kano", "Ibadan", "Port Harcourt"],
  ZA: ["Johannesburg", "Cape Town", "Durban", "Pretoria", "Port Elizabeth"],
  NL: ["Amsterdam", "Rotterdam", "The Hague", "Utrecht", "Eindhoven"],
};

// ─── Location Data Interface ─────────────────────────────────────────────────

export interface ProjectLocation {
  country: string;
  countryCode: string;
  state: string;
  city: string;
  currency: string;
  currencySymbol: string;
  exchangeRate: number;
  countryFactor: number;
  cityTier: CityTier;
  cityTierFactor: number;
  combinedFactor: number;  // countryFactor × cityTierFactor
}

/**
 * Resolve a complete ProjectLocation from user inputs.
 */
export function resolveProjectLocation(
  country: string,
  state: string,
  city: string,
  currencyOverride?: string
): ProjectLocation {
  const countryData = COUNTRY_FACTORS.find(
    c => c.country.toLowerCase() === country.toLowerCase() || c.code.toLowerCase() === country.toLowerCase()
  ) || COUNTRY_FACTORS[0]; // default to USA

  const cityTier = detectCityTier(city, countryData.code);
  const cityTierFactor = CITY_TIER_FACTORS[cityTier].factor;

  const currency = currencyOverride || countryData.currency;
  const currencyEntry = COUNTRY_FACTORS.find(c => c.currency === currency);

  return {
    country: countryData.country,
    countryCode: countryData.code,
    state,
    city,
    currency,
    currencySymbol: currencyEntry?.currencySymbol || countryData.currencySymbol,
    exchangeRate: currencyEntry?.exchangeRate || countryData.exchangeRate,
    countryFactor: countryData.factor,
    cityTier,
    cityTierFactor,
    combinedFactor: countryData.factor * cityTierFactor,
  };
}

// ─── Derived Quantity Rates (USD baseline) ───────────────────────────────────
// These rates are applied with the same location factor as hard costs

export const DERIVED_RATES = {
  formwork: {
    wall: { rate: 48.44, unit: "m²", notes: "Plywood forms, 2 uses (both sides)" },   // ~$4.50/SF
    slab: { rate: 37.67, unit: "m²", notes: "Shoring + decking (soffit)" },            // ~$3.50/SF
    column: { rate: 53.82, unit: "m²", notes: "Fiber tube or custom" },                // ~$5.00/SF
    beam: { rate: 64.58, unit: "m²", notes: "Custom box forms" },                      // ~$6.00/SF
  },
  rebar: {
    slab: { kgPerM3: 90, rate: 1.87, unit: "kg", notes: "Avg 80-120 kg/m³" },         // ~$0.85/lb
    column: { kgPerM3: 200, rate: 1.87, unit: "kg", notes: "Avg 150-250 kg/m³" },
    beam: { kgPerM3: 160, rate: 1.87, unit: "kg", notes: "Avg 120-200 kg/m³" },
    wall: { kgPerM3: 50, rate: 1.87, unit: "kg", notes: "Avg 30-70 kg/m³" },
  },
  finishing: {
    plastering: { rate: 8.00, unit: "m²", notes: "Cement plaster, 2 coats" },
    painting: { rate: 3.50, unit: "m²", notes: "2 coats emulsion" },
    ceilingPlaster: { rate: 10.00, unit: "m²", notes: "Ceiling plaster + POP" },
  },
} as const;
