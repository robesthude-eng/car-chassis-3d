import * as THREE from "three";

export function createSceneMaterials(maps) {
  const { castMaps, machinedMaps, rubberMaps, treadMaps, discMaps } = maps;
  const materials = {
    frame: new THREE.MeshStandardMaterial({
      color: 0x1e242b,
      metalness: 0.85,
      roughness: 0.35,
    }),
    subframeAluminum: new THREE.MeshStandardMaterial({
      color: 0x5a6578,
      metalness: 0.92,
      roughness: 0.28,
    }),
    consoleBracket: new THREE.MeshStandardMaterial({
      color: 0x64748b,
      metalness: 0.94,
      roughness: 0.25,
    }),
    controlArmAluminum: new THREE.MeshStandardMaterial({
      color: 0xc7d2fe,
      metalness: 0.9,
      roughness: 0.25,
    }),
    /* Задние тяги многорычажки — отдельная зона от переднего рычага */
    rearLinkAluminum: new THREE.MeshStandardMaterial({
      color: 0xc7d2fe,
      metalness: 0.9,
      roughness: 0.25,
    }),
    /* Механическая обработка: плиты, гнёзда, приливы (раньше отсутствовал) */
    bracket: new THREE.MeshStandardMaterial({
      color: 0x8b95a1,
      metalness: 0.95,
      roughness: 0.3,
    }),
    /* Резина сайлентблоков — расходник, выделяется в цветовых зонах */
    bushingRubber: new THREE.MeshStandardMaterial({
      color: 0x14181d,
      metalness: 0.05,
      roughness: 0.95,
    }),
    /* Тарелки и чашки пружин */
    springSeat: new THREE.MeshStandardMaterial({
      color: 0x6b7480,
      metalness: 0.9,
      roughness: 0.4,
    }),
    /* Шток рулевой рейки — часть рулевого контура */
    steeringShaft: new THREE.MeshStandardMaterial({
      color: 0xf2f4f6,
      metalness: 1.0,
      roughness: 0.05,
    }),
    ballJointSteel: new THREE.MeshStandardMaterial({
      color: 0x334155,
      metalness: 0.92,
      roughness: 0.22,
    }),
    bolt: new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      metalness: 0.98,
      roughness: 0.1,
    }),
    driveshaft: new THREE.MeshStandardMaterial({
      color: 0xa0aec0,
      metalness: 0.95,
      roughness: 0.15,
    }),
    ujoint: new THREE.MeshStandardMaterial({
      color: 0x2d3748,
      metalness: 0.9,
      roughness: 0.25,
    }),
    diffHousing: new THREE.MeshStandardMaterial({
      color: 0x334155,
      metalness: 0.8,
      roughness: 0.45,
    }),
    diffCover: new THREE.MeshStandardMaterial({
      color: 0x64748b,
      metalness: 0.85,
      roughness: 0.3,
    }),
    diffGears: new THREE.MeshStandardMaterial({
      color: 0xd97706,
      metalness: 0.95,
      roughness: 0.2,
    }),
    halfShaft: new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      metalness: 0.9,
      roughness: 0.25,
    }),
    cvBoots: new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.85,
      metalness: 0.05,
    }),
    mcphersonStrut: new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      metalness: 0.88,
      roughness: 0.22,
    }),
    mcphersonSpring: new THREE.MeshStandardMaterial({
      color: 0xfacc15,
      metalness: 0.4,
      roughness: 0.2,
    }),
    damperShaft: new THREE.MeshStandardMaterial({
      color: 0xffffff,
      metalness: 1.0,
      roughness: 0.05,
    }),
    knuckleCastIron: new THREE.MeshStandardMaterial({
      color: 0x384252,
      metalness: 0.9,
      roughness: 0.35,
    }),
    hubWheelBearing: new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      metalness: 0.95,
      roughness: 0.2,
    }),
    brakeDisc: new THREE.MeshStandardMaterial({
      color: 0xcccccc,
      metalness: 0.92,
      roughness: 0.25,
      emissive: new THREE.Color(0x000000),
      emissiveIntensity: 0,
    }),
    brakeCaliper: new THREE.MeshStandardMaterial({
      color: 0xdc2626,
      metalness: 0.5,
      roughness: 0.2,
    }),
    steeringRack: new THREE.MeshStandardMaterial({
      color: 0x64748b,
      metalness: 0.88,
      roughness: 0.25,
    }),
    steeringTieRod: new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      metalness: 0.92,
      roughness: 0.2,
    }),
    rim: new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      metalness: 0.92,
      roughness: 0.18,
    }),
    tire: new THREE.MeshStandardMaterial({
      color: 0x18181b,
      roughness: 0.9,
      metalness: 0.05,
    }),
    rigPlatform: new THREE.MeshStandardMaterial({
      color: 0x334155,
      metalness: 0.85,
      roughness: 0.35,
    }),
    rigPiston: new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      metalness: 0.98,
      roughness: 0.08,
    }),
    swayBar: new THREE.MeshStandardMaterial({
      color: 0x10b981,
      metalness: 0.8,
      roughness: 0.3,
    }),
    xrayChassis: new THREE.MeshPhysicalMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.2,
      roughness: 0.1,
      metalness: 0.1,
      transmission: 0.6,
      depthWrite: false,
    }),
  };

  (function refineMaterials() {
    const cast = castMaps();
    const mach = machinedMaps();
    const rub = rubberMaps();
    const disc = discMaps();
    const tread = treadMaps();
    const V2 = (x, y) => new THREE.Vector2(x, y);
    const apply = (key, props) => {
      const m = materials[key];
      if (!m) return;
      Object.keys(props).forEach((k) => {
        if (k === "color" || k === "emissive") m[k].setHex(props[k]);
        else m[k] = props[k];
      });
      m.needsUpdate = true;
    };

    /* Кузовная сталь — катафорезная грунтовка */
    apply("frame", {
      color: 0x262b32,
      metalness: 0.85,
      roughness: 1.0,
      roughnessMap: cast.rough,
      normalMap: cast.normal,
      normalScale: V2(0.35, 0.35),
      envMapIntensity: 0.9,
    });
    /* Литой алюминиевый подрамник 1K0 199 369 F */
    apply("subframeAluminum", {
      color: 0x8d959f,
      metalness: 1.0,
      roughness: 1.0,
      roughnessMap: cast.rough,
      normalMap: cast.normal,
      normalScale: V2(0.85, 0.85),
      envMapIntensity: 1.15,
    });
    apply("consoleBracket", {
      color: 0x7c8794,
      metalness: 1.0,
      roughness: 0.95,
      roughnessMap: cast.rough,
      normalMap: cast.normal,
      normalScale: V2(0.6, 0.6),
      envMapIntensity: 1.1,
    });
    /* Кованый рычаг 1K0 407 151 */
    apply("controlArmAluminum", {
      color: 0xb9c0c8,
      metalness: 1.0,
      roughness: 0.85,
      roughnessMap: cast.rough,
      normalMap: cast.normal,
      normalScale: V2(0.5, 0.5),
      envMapIntensity: 1.25,
    });
    apply("ballJointSteel", {
      color: 0x3b4350,
      metalness: 1.0,
      roughness: 0.42,
      roughnessMap: mach.rough,
      envMapIntensity: 1.1,
    });
    /* Оцинкованный крепёж класса 10.9 */
    apply("bolt", {
      color: 0xc9d1d9,
      metalness: 1.0,
      roughness: 0.42,
      roughnessMap: mach.rough,
      normalMap: mach.normal,
      normalScale: V2(0.35, 0.35),
      envMapIntensity: 1.3,
    });
    apply("driveshaft", {
      color: 0x9098a2,
      metalness: 1.0,
      roughness: 0.38,
      roughnessMap: mach.rough,
      normalMap: mach.normal,
      normalScale: V2(0.3, 0.3),
      envMapIntensity: 1.2,
    });
    apply("ujoint", {
      color: 0x353b43,
      metalness: 0.95,
      roughness: 0.9,
      roughnessMap: cast.rough,
      normalMap: cast.normal,
      normalScale: V2(0.6, 0.6),
      envMapIntensity: 0.95,
    });
    apply("diffHousing", {
      color: 0x5d656f,
      metalness: 0.95,
      roughness: 1.0,
      roughnessMap: cast.rough,
      normalMap: cast.normal,
      normalScale: V2(0.9, 0.9),
      envMapIntensity: 1.0,
    });
    apply("diffCover", {
      color: 0x76808c,
      metalness: 1.0,
      roughness: 0.95,
      roughnessMap: cast.rough,
      normalMap: cast.normal,
      normalScale: V2(0.7, 0.7),
      envMapIntensity: 1.05,
    });
    /* Цементированные шестерни главной пары */
    apply("diffGears", {
      color: 0xbf9a4f,
      metalness: 1.0,
      roughness: 0.32,
      roughnessMap: mach.rough,
      envMapIntensity: 1.25,
    });
    apply("halfShaft", {
      color: 0x2e353d,
      metalness: 1.0,
      roughness: 0.45,
      roughnessMap: mach.rough,
      envMapIntensity: 1.0,
    });
    /* Резина пыльников ШРУС */
    apply("cvBoots", {
      color: 0x0e1114,
      metalness: 0.0,
      roughness: 1.0,
      roughnessMap: rub.rough,
      normalMap: rub.normal,
      normalScale: V2(0.8, 0.8),
      envMapIntensity: 0.35,
    });
    apply("damperShaft", {
      color: 0xf2f4f6,
      metalness: 1.0,
      roughness: 0.035,
      envMapIntensity: 1.5,
    });
    /* Чугунная цапфа 1K0 407 255 */
    apply("knuckleCastIron", {
      color: 0x4d545c,
      metalness: 0.8,
      roughness: 1.0,
      roughnessMap: cast.rough,
      normalMap: cast.normal,
      normalScale: V2(1.0, 1.0),
      envMapIntensity: 0.85,
    });
    apply("hubWheelBearing", {
      color: 0x262c33,
      metalness: 1.0,
      roughness: 0.55,
      roughnessMap: mach.rough,
      envMapIntensity: 1.0,
    });
    /* Вентилируемый диск 340 мм: борозды, перфорация, ржавая ступица */
    apply("brakeDisc", {
      color: 0xffffff,
      map: disc.color,
      roughnessMap: disc.rough,
      normalMap: disc.normal,
      normalScale: V2(0.5, 0.5),
      metalness: 1.0,
      roughness: 1.0,
      envMapIntensity: 0.85,
    });
    apply("steeringRack", {
      color: 0x6d7783,
      metalness: 1.0,
      roughness: 0.95,
      roughnessMap: cast.rough,
      normalMap: cast.normal,
      normalScale: V2(0.7, 0.7),
      envMapIntensity: 1.05,
    });
    apply("steeringTieRod", {
      color: 0x99a1aa,
      metalness: 1.0,
      roughness: 0.32,
      roughnessMap: mach.rough,
      envMapIntensity: 1.25,
    });
    /* Покрышка 225/40 R18 */
    apply("tire", {
      color: 0x121316,
      metalness: 0.0,
      roughness: 1.0,
      roughnessMap: rub.rough,
      normalMap: tread.normal,
      normalScale: V2(1.1, 1.1),
      envMapIntensity: 0.3,
    });
    apply("rigPlatform", {
      color: 0x3a424c,
      metalness: 0.9,
      roughness: 1.0,
      roughnessMap: cast.rough,
      normalMap: cast.normal,
      normalScale: V2(0.7, 0.7),
      envMapIntensity: 0.8,
    });
    apply("rigPiston", {
      color: 0xeef1f4,
      metalness: 1.0,
      roughness: 0.05,
      envMapIntensity: 1.45,
    });
    apply("swayBar", {
      color: 0x10b981,
      metalness: 0.35,
      roughness: 0.5,
      roughnessMap: cast.rough,
      normalMap: cast.normal,
      normalScale: V2(0.4, 0.4),
      envMapIntensity: 0.9,
    });

    apply("rearLinkAluminum", {
      color: 0xb9c0c8,
      metalness: 1.0,
      roughness: 0.85,
      roughnessMap: cast.rough,
      normalMap: cast.normal,
      normalScale: V2(0.5, 0.5),
      envMapIntensity: 1.25,
    });
    apply("bracket", {
      color: 0x8b95a1,
      metalness: 1.0,
      roughness: 0.5,
      roughnessMap: mach.rough,
      normalMap: mach.normal,
      normalScale: V2(0.4, 0.4),
      envMapIntensity: 1.15,
    });
    /* Резина сайлентблока: EPDM, без блеска */
    apply("bushingRubber", {
      color: 0x14181d,
      metalness: 0.0,
      roughness: 1.0,
      roughnessMap: rub.rough,
      normalMap: rub.normal,
      normalScale: V2(0.9, 0.9),
      envMapIntensity: 0.3,
    });
    apply("springSeat", {
      color: 0x6b7480,
      metalness: 0.95,
      roughness: 0.85,
      roughnessMap: cast.rough,
      normalMap: cast.normal,
      normalScale: V2(0.5, 0.5),
      envMapIntensity: 1.0,
    });
    apply("steeringShaft", {
      color: 0xf2f4f6,
      metalness: 1.0,
      roughness: 0.04,
      envMapIntensity: 1.5,
    });

    /* Окрашенные узлы получают лаковый слой (clearcoat) */
    materials.mcphersonStrut = new THREE.MeshPhysicalMaterial({
      color: 0x1f6f9e,
      metalness: 0.6,
      roughness: 0.42,
      roughnessMap: cast.rough,
      normalMap: cast.normal,
      normalScale: V2(0.3, 0.3),
      clearcoat: 0.75,
      clearcoatRoughness: 0.22,
      envMapIntensity: 1.1,
    });
    materials.mcphersonSpring = new THREE.MeshPhysicalMaterial({
      color: 0xd8a41c,
      metalness: 0.45,
      roughness: 0.45,
      roughnessMap: mach.rough,
      clearcoat: 0.5,
      clearcoatRoughness: 0.3,
      envMapIntensity: 1.15,
    });
    materials.brakeCaliper = new THREE.MeshPhysicalMaterial({
      color: 0xa8171b,
      metalness: 0.25,
      roughness: 0.5,
      roughnessMap: cast.rough,
      normalMap: cast.normal,
      normalScale: V2(0.55, 0.55),
      clearcoat: 0.8,
      clearcoatRoughness: 0.25,
      envMapIntensity: 1.0,
    });
    materials.rim = new THREE.MeshPhysicalMaterial({
      color: 0xa9b0b8,
      metalness: 1.0,
      roughness: 0.26,
      roughnessMap: mach.rough,
      clearcoat: 0.6,
      clearcoatRoughness: 0.15,
      envMapIntensity: 1.35,
    });

    /* Дополнительные отделки для новых деталей */
    materials.boltThread = new THREE.MeshStandardMaterial({
      color: 0x8f97a1,
      metalness: 1.0,
      roughness: 0.55,
      roughnessMap: mach.rough,
      normalMap: mach.normal,
      normalScale: V2(0.8, 0.8),
      envMapIntensity: 1.0,
    });
    materials.rimInner = new THREE.MeshStandardMaterial({
      color: 0x33383f,
      metalness: 0.9,
      roughness: 0.7,
      roughnessMap: cast.rough,
      envMapIntensity: 0.6,
    });
    materials.brakePad = new THREE.MeshStandardMaterial({
      color: 0x2b2723,
      metalness: 0.2,
      roughness: 0.95,
      roughnessMap: cast.rough,
      normalMap: cast.normal,
      normalScale: V2(0.5, 0.5),
      envMapIntensity: 0.4,
    });
    materials.tireSidewall = new THREE.MeshStandardMaterial({
      color: 0x0f1013,
      metalness: 0.0,
      roughness: 1.0,
      roughnessMap: rub.rough,
      normalMap: rub.normal,
      normalScale: V2(0.6, 0.6),
      envMapIntensity: 0.28,
    });
  })();

  /* Имя материала = имя зоны: нужно для цветовых зон и диагностики */
  Object.keys(materials).forEach((key) => {
    materials[key].name = key;
  });

  return materials;
}

/* ══ ЦВЕТОВЫЕ ЗОНЫ ══
 neutral — заводской цвет детали, coded — цвет в режиме «Цветовые зоны».
 Зоны собраны по смыслу узла, а не по материалу изготовления:
  красный   — передние рычаги          фиолетовый — задние тяги
  синий     — крепления к кузову       оранжевый  — рулевой контур целиком
  розовый   — сайлентблоки (резина)    лайм       — шаровые и наконечники
  жёлтый    — пружины и их тарелки     голубой    — амортизаторы
  зелёный   — стабилизаторы
 Кузов, подрамник, крепёж и стенд в этом режиме уходят в тень. */
export const COLOR_ZONES = [
  /* фон: уводим вниз по контрасту */
  { key: "frame", neutral: 0x262b32, coded: 0x1b2027 },
  { key: "subframeAluminum", neutral: 0x8d959f, coded: 0x5f6874 },
  { key: "bracket", neutral: 0x8b95a1, coded: 0x767f8a },
  { key: "bolt", neutral: 0xc9d1d9, coded: 0x8a929b },
  { key: "boltThread", neutral: 0x8f97a1, coded: 0x777f88 },
  { key: "rigPlatform", neutral: 0x3a424c, coded: 0x2c333b },
  { key: "rigPiston", neutral: 0xeef1f4, coded: 0xaeb6bf },
  /* крепления к кузову */
  { key: "consoleBracket", neutral: 0x7c8794, coded: 0x3b82f6 },
  /* рычаги и тяги */
  { key: "controlArmAluminum", neutral: 0xb9c0c8, coded: 0xef4444 },
  { key: "rearLinkAluminum", neutral: 0xb9c0c8, coded: 0xa855f7 },
  /* шарниры-расходники */
  { key: "bushingRubber", neutral: 0x14181d, coded: 0xec4899 },
  { key: "ballJointSteel", neutral: 0x3b4350, coded: 0x84cc16 },
  /* упругие элементы */
  { key: "mcphersonSpring", neutral: 0xd8a41c, coded: 0xfacc15 },
  { key: "springSeat", neutral: 0x6b7480, coded: 0xa16207 },
  { key: "mcphersonStrut", neutral: 0x1f6f9e, coded: 0x0ea5e9 },
  { key: "damperShaft", neutral: 0xf2f4f6, coded: 0xdfe4e9 },
  /* рулевой контур */
  { key: "steeringRack", neutral: 0x6d7783, coded: 0xf97316 },
  { key: "steeringShaft", neutral: 0xf2f4f6, coded: 0xfdba74 },
  { key: "steeringTieRod", neutral: 0x99a1aa, coded: 0xfb923c },
  /* стабилизаторы */
  { key: "swayBar", neutral: 0x10b981, coded: 0x22c55e },
];
