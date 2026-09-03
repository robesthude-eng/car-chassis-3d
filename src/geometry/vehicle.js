export async function buildVehicle(ctx) {
  const {
    THREE,
    materials,
    SEG,
    CHASSIS,
    chassisFrameGroup,
    frontSubframeGroup,
    rearSubframeGroup,
    drivetrainGroup,
    suspensionGroup,
    steeringGroup,
    wheelsGroup,
    rigPlatformsGroup,
    bootProgress,
    nextFrame,
    isMobile,
  } = ctx;

  const assemblyState = {
    subframeBolted: true,
    strutsBolted: true,
    armsBolted: true,
    balljointsBolted: true,
    steeringBolted: true,
    wheelsBolted: true,
    driveshaftsBolted: true,
    rearLinksBolted: true,
  };

  function createHexBoltMesh(radius = 0.016, length = 0.04) {
    const group = new THREE.Group();
    const hr = radius * 1.35;

    /* Шестигранная головка с фаской */
    const headGeo = new THREE.CylinderGeometry(hr * 0.9, hr, 0.013, 6);
    const head = new THREE.Mesh(headGeo, materials.bolt);
    head.rotation.x = Math.PI / 2;
    head.position.z = length * 0.5 + 0.0085;
    head.castShadow = true;
    group.add(head);

    /* Кольцевой буртик под головкой */
    const collarGeo = new THREE.CylinderGeometry(
      hr * 0.98,
      hr * 0.86,
      0.004,
      16,
    );
    const collar = new THREE.Mesh(collarGeo, materials.bolt);
    collar.rotation.x = Math.PI / 2;
    collar.position.z = length * 0.5 + 0.0005;
    group.add(collar);

    /* Резьбовая часть */
    const studGeo = new THREE.CylinderGeometry(
      radius,
      radius * 0.94,
      length,
      16,
    );
    const stud = new THREE.Mesh(
      studGeo,
      materials.boltThread || materials.bolt,
    );
    stud.rotation.x = Math.PI / 2;
    stud.castShadow = true;
    group.add(stud);

    /* Шайба */
    const washerGeo = new THREE.CylinderGeometry(
      radius * 1.75,
      radius * 1.75,
      0.0035,
      20,
    );
    const washer = new THREE.Mesh(washerGeo, materials.bolt);
    washer.rotation.x = Math.PI / 2;
    washer.position.z = length * 0.5 - 0.002;
    group.add(washer);

    return group;
  }

  const structuralUp = new THREE.Vector3(0, 1, 0);

  function V3(x, y, z) {
    return new THREE.Vector3(x, y, z);
  }

  /* Силовой профиль между двумя расчётными точками. Геометрия строится по
   фактическим координатам креплений, поэтому после изменения кинематики
   кронштейны и силовая структура не расходятся визуально. */
  function addBoxBeam(
    parent,
    from,
    to,
    width = 0.05,
    depth = width,
    material = materials.frame,
  ) {
    const direction = new THREE.Vector3().subVectors(to, from);
    const length = Math.max(0.001, direction.length());
    const beam = new THREE.Mesh(
      new THREE.BoxGeometry(width, 1, depth),
      material,
    );
    beam.position.copy(from).addScaledVector(direction, 0.5);
    beam.quaternion.setFromUnitVectors(
      structuralUp,
      direction.multiplyScalar(1 / length),
    );
    beam.scale.y = length;
    beam.castShadow = true;
    beam.receiveShadow = true;
    parent.add(beam);
    return beam;
  }

  /* Две щеки, перемычка и сквозной болт образуют видимый силовой узел вокруг
   сайлентблока. Ось z используется для поперечных рычагов, x — для
   продольного рычага, y — для вертикальных опор подрамника. */
  function addClevisMount(
    parent,
    point,
    axis = "z",
    { gap = 0.052, height = 0.09, span = 0.09, boltRadius = 0.009 } = {},
  ) {
    const mount = new THREE.Group();
    mount.position.copy(point);
    const plateThickness = 0.012;

    [-1, 1].forEach((side) => {
      const geometry =
        axis === "x"
          ? new THREE.BoxGeometry(plateThickness, height, span)
          : new THREE.BoxGeometry(span, height, plateThickness);
      const plate = new THREE.Mesh(geometry, materials.consoleBracket);
      if (axis === "x") {
        plate.position.x = side * (gap + plateThickness) * 0.5;
      } else {
        plate.position.z = side * (gap + plateThickness) * 0.5;
      }
      plate.castShadow = true;
      mount.add(plate);
    });

    const bridge = new THREE.Mesh(
      axis === "x"
        ? new THREE.BoxGeometry(gap + plateThickness * 2, 0.014, span)
        : new THREE.BoxGeometry(span, 0.014, gap + plateThickness * 2),
      materials.consoleBracket,
    );
    bridge.position.y = height * 0.5;
    bridge.castShadow = true;
    mount.add(bridge);

    const bolt = createHexBoltMesh(boltRadius, gap + plateThickness * 3);
    if (axis === "x") bolt.rotation.y = Math.PI / 2;
    if (axis === "y") bolt.rotation.x = Math.PI / 2;
    mount.add(bolt);
    parent.add(mount);
    return mount;
  }

  function addBodyMountReceiver(parent, x, z) {
    const cup = new THREE.Mesh(
      new THREE.CylinderGeometry(0.052, 0.045, 0.075, SEG(18, 10)),
      materials.frame,
    );
    cup.position.set(x, 0.225, z);
    cup.castShadow = true;
    parent.add(cup);

    const sleeve = new THREE.Mesh(
      new THREE.CylinderGeometry(0.022, 0.022, 0.082, SEG(16, 8)),
      materials.bushingRubber,
    );
    sleeve.position.copy(cup.position);
    parent.add(sleeve);
  }

  /* 1. BUILD CHASSIS FRAME & STRUT TOWERS */
  function buildChassisFrame() {
    const railMat = materials.frame;

    [-CHASSIS.mainRailX, CHASSIS.mainRailX].forEach((x) => {
      const sign = Math.sign(x);
      const railGeo = new THREE.BoxGeometry(0.06, 0.09, 2.4);
      const rail = new THREE.Mesh(railGeo, railMat);
      rail.position.set(x, 0.22, 0);
      rail.castShadow = true;
      rail.receiveShadow = true;
      chassisFrameGroup.add(rail);

      const frontKickGeo = new THREE.BoxGeometry(0.06, 0.09, 0.8);
      const frontKick = new THREE.Mesh(frontKickGeo, railMat);
      frontKick.position.set(x, 0.24, CHASSIS.frontAxleZ);
      frontKick.rotation.x = -0.1;
      frontKick.castShadow = true;
      chassisFrameGroup.add(frontKick);

      /* Задний лонжерон уходит ВВЕРХ над осью. Прямая балка на высоте
       0.26 там физически невозможна: на x 0.42...0.48 четыре рычага заметают
       коридор y 0.07...0.44, и балка стояла прямо в них. Теперь кик-ап
       поднимает лонжерон на 0.52 — на нём же стоит стакан амортизатора. */
      const rearKickBase = CHASSIS.rearAxleZ - 0.31;
      const rearKickTop = CHASSIS.rearAxleZ - 0.11;
      const rearRailY = 0.52;
      const rearRailYAt = (z) =>
        z <= rearKickTop
          ? 0.24 +
            ((z - rearKickBase) / (rearKickTop - rearKickBase)) *
              (rearRailY - 0.24)
          : rearRailY;
      addBoxBeam(
        chassisFrameGroup,
        V3(x, 0.24, rearKickBase),
        V3(x, rearRailY, rearKickTop),
        0.06,
        0.09,
        railMat,
      );
      addBoxBeam(
        chassisFrameGroup,
        V3(x, rearRailY, rearKickTop),
        V3(x, rearRailY, CHASSIS.rearAxleZ + 0.42),
        0.06,
        0.09,
        railMat,
      );
      /* Кузовные опоры подрамника висят на кронштейнах под лонжероном. */
      CHASSIS.rearSubframe.bodyMounts.forEach((mountPoint) => {
        const mz = CHASSIS.rearAxleZ + mountPoint.z;
        addBoxBeam(
          chassisFrameGroup,
          V3(x, rearRailYAt(mz) - 0.02, mz),
          V3(x, 0.235, mz),
          0.05,
          0.06,
          railMat,
        );
      });

      // FRONT STRUT TOWERS
      const towerFrontGroup = new THREE.Group();
      towerFrontGroup.position.set(
        sign * CHASSIS.front.towerX,
        0.24,
        CHASSIS.frontAxleZ,
      );

      const strutTowerTrussGeo = new THREE.CylinderGeometry(
        0.018,
        0.026,
        0.64,
        10,
      );
      const strutLeg1 = new THREE.Mesh(
        strutTowerTrussGeo,
        materials.subframeAluminum,
      );
      strutLeg1.position.set(0, 0.3, 0.09);
      strutLeg1.rotation.x = -0.16;
      strutLeg1.castShadow = true;
      towerFrontGroup.add(strutLeg1);

      const strutLeg2 = new THREE.Mesh(
        strutTowerTrussGeo,
        materials.subframeAluminum,
      );
      strutLeg2.position.set(0, 0.3, -0.09);
      strutLeg2.rotation.x = 0.16;
      strutLeg2.castShadow = true;
      towerFrontGroup.add(strutLeg2);

      /* Раньше эта нога шла наружу и доходила до x = 0.713 при внутренней
       кромке покрышки 0.676 - то есть жила внутри боковины колеса.
       Развернута внутрь и опирается на панель арки: до колеса 77 мм. */
      const strutLegOuter = new THREE.Mesh(
        new THREE.CylinderGeometry(0.016, 0.022, 0.54, 10),
        materials.subframeAluminum,
      );
      strutLegOuter.position.set(-sign * 0.05, 0.33, 0);
      strutLegOuter.rotation.z = sign * 0.1;
      strutLegOuter.castShadow = true;
      towerFrontGroup.add(strutLegOuter);

      const towerBrace = new THREE.Mesh(
        new THREE.BoxGeometry(0.055, 0.014, 0.19),
        materials.subframeAluminum,
      );
      towerBrace.position.set(0, 0.4, 0);
      towerFrontGroup.add(towerBrace);

      const towerCone = new THREE.Mesh(
        new THREE.CylinderGeometry(0.078, 0.125, 0.11, 22, 1, true),
        materials.frame,
      );
      towerCone.position.set(0, 0.555, 0);
      towerCone.castShadow = true;
      towerFrontGroup.add(towerCone);

      const topHatPlateGeo = new THREE.CylinderGeometry(
        0.078,
        0.078,
        0.022,
        22,
      );
      const topPlate = new THREE.Mesh(topHatPlateGeo, materials.bracket);
      topPlate.position.set(0, 0.621, 0);
      topPlate.castShadow = true;
      towerFrontGroup.add(topPlate);

      for (let sn = 0; sn < 3; sn++) {
        const sang = (sn / 3) * Math.PI * 2;
        const topNut = createHexBoltMesh(0.008, 0.022);
        topNut.rotation.x = Math.PI / 2;
        topNut.position.set(
          Math.cos(sang) * 0.052,
          0.641,
          Math.sin(sang) * 0.052,
        );
        towerFrontGroup.add(topNut);
      }
      chassisFrameGroup.add(towerFrontGroup);

      /* Панель колёсной арки: связывает стакан с лонжероном кузова, иначе
       стакан после переноса на реальные ±600 мм висел бы в воздухе */
      const archPanel = new THREE.Mesh(
        new THREE.BoxGeometry(0.17, 0.055, 0.24),
        materials.frame,
      );
      archPanel.position.set(sign * 0.525, 0.29, CHASSIS.frontAxleZ);
      archPanel.castShadow = true;
      chassisFrameGroup.add(archPanel);

      const archGusset = new THREE.Mesh(
        new THREE.BoxGeometry(0.022, 0.3, 0.2),
        materials.subframeAluminum,
      );
      archGusset.position.set(sign * 0.545, 0.44, CHASSIS.frontAxleZ);
      chassisFrameGroup.add(archGusset);

      /* Задний амортизатор крепится на 110 мм позади оси колеса. Раньше
       стакан стоял строго над осью, поэтому верхняя опора висела рядом с ним. */
      const rearDamperTop = CHASSIS.rearBody.damperTop;
      const towerRearGroup = new THREE.Group();
      towerRearGroup.position.set(
        sign * rearDamperTop.x,
        rearDamperTop.y - 0.32,
        CHASSIS.rearAxleZ + rearDamperTop.z,
      );
      /* Ноги стакана уходят внутрь кузова и обе встают на косынку
       арки (x = 0.528), а не отвесно вниз вдоль амортизатора.
       Раньше три ноги шли по его же оси до y ≈ 0.12, а наружная (x = 0.685)
       вообще задевала внутреннюю боковину шины: на экране это читалось
       как «три трубы», внутри которых где-то спрятан сам амортизатор. */
      const rearTrussGeo = new THREE.CylinderGeometry(0.015, 0.023, 0.34, 10);
      [0.085, -0.085].forEach((legZ) => {
        const rLeg = new THREE.Mesh(rearTrussGeo, materials.subframeAluminum);
        rLeg.position.set(-sign * 0.055, 0.17, legZ);
        rLeg.rotation.z = -sign * 0.28;
        rLeg.castShadow = true;
        towerRearGroup.add(rLeg);
      });

      /* Третьей ноги у стакана нет сознательно: вниз его держит уже
       существующая косынка задней арки (rearArchGusset ниже). Раньше
       здесь стояла ещё одна пластина: она дублировала косынку и
       проходила сквозь сам амортизатор. */

      /* Сам стакан узкий и поднят, чтобы под ним была видна верхняя
       опора амортизатора и шток */
      const rearCone = new THREE.Mesh(
        new THREE.CylinderGeometry(0.046, 0.066, 0.08, 22, 1, true),
        materials.frame,
      );
      rearCone.position.set(0, 0.29, 0);
      rearCone.castShadow = true;
      towerRearGroup.add(rearCone);
      const rTopPlate = new THREE.Mesh(topHatPlateGeo, materials.frame);
      rTopPlate.position.set(0, 0.345, 0);
      rTopPlate.castShadow = true;
      towerRearGroup.add(rTopPlate);
      for (let rn = 0; rn < 3; rn++) {
        const rang = (rn / 3) * Math.PI * 2 + 0.5;
        const rNut = createHexBoltMesh(0.008, 0.02);
        rNut.rotation.x = Math.PI / 2;
        rNut.position.set(
          Math.cos(rang) * 0.048,
          0.364,
          Math.sin(rang) * 0.048,
        );
        towerRearGroup.add(rNut);
      }
      chassisFrameGroup.add(towerRearGroup);

      /* Косынка стакана - единственный лист в этой зоне. Габарит
       посчитан в scripts/audit-clearances.mjs: позади пружины (z >= 1.39),
       выше сходовой тяги (y >= 0.35) и внутри от корпуса амортизатора
       (x <= 0.579). На неё опираются обе ноги стакана. */
      const rearArchGusset = new THREE.Mesh(
        new THREE.BoxGeometry(0.022, 0.22, 0.21),
        materials.subframeAluminum,
      );
      rearArchGusset.position.set(
        sign * 0.528,
        0.51,
        CHASSIS.rearAxleZ + 0.19,
      );
      rearArchGusset.castShadow = true;
      chassisFrameGroup.add(rearArchGusset);

      /* Подкос лонжерон -> косынка проходит позади сходовой тяги. */
      addBoxBeam(
        chassisFrameGroup,
        V3(sign * CHASSIS.mainRailX, 0.5, CHASSIS.rearAxleZ + 0.35),
        V3(sign * 0.528, 0.47, CHASSIS.rearAxleZ + 0.26),
        0.04,
        0.05,
        materials.subframeAluminum,
      );

      /* Верхняя чашка задней пружины — отдельный узел кузова PQ35. Точка
       полностью совпадает с расчётной неподвижной опорой пружины. */
      const springTopSpec = CHASSIS.rearBody.springTop;
      const springTop = V3(
        sign * springTopSpec.x,
        springTopSpec.y,
        CHASSIS.rearAxleZ + springTopSpec.z,
      );
      const springCup = new THREE.Mesh(
        new THREE.CylinderGeometry(0.084, 0.066, 0.026, SEG(24, 14)),
        materials.frame,
      );
      springCup.position.copy(springTop);
      springCup.castShadow = true;
      chassisFrameGroup.add(springCup);

      const springCupRing = new THREE.Mesh(
        new THREE.TorusGeometry(0.066, 0.009, SEG(8, 6), SEG(24, 14)),
        materials.springSeat,
      );
      springCupRing.rotation.x = Math.PI / 2;
      springCupRing.position.copy(springTop);
      springCupRing.position.y -= 0.017;
      chassisFrameGroup.add(springCupRing);

      /* Подкос лонжерон -> чашка подходит к чашке спереди-снизу,
       мимо витков (расчётный зазор 9 мм), а не сквозь пружину. */
      addBoxBeam(
        chassisFrameGroup,
        V3(sign * CHASSIS.mainRailX, 0.42, CHASSIS.rearAxleZ - 0.2),
        V3(sign * 0.5, springTop.y - 0.015, CHASSIS.rearAxleZ - 0.06),
        0.038,
        0.05,
        materials.subframeAluminum,
      );
      /* Связь косынки стакана с чашкой идёт на уровне самой чашки:
       ниже проходят витки, снаружи - корпус амортизатора. */
      addBoxBeam(
        chassisFrameGroup,
        V3(sign * 0.528, springTop.y + 0.005, CHASSIS.rearAxleZ + 0.14),
        V3(sign * 0.55, springTop.y + 0.005, CHASSIS.rearAxleZ + 0.05),
        0.03,
        0.04,
        materials.subframeAluminum,
      );

      /* Передняя опора продольного рычага закреплена в усилителе порога,
       а не в заднем подрамнике. */
      const trailingSpec = CHASSIS.rearBody.trailingArm;
      const trailingPoint = V3(
        sign * trailingSpec.x,
        trailingSpec.y,
        CHASSIS.rearAxleZ + trailingSpec.z,
      );
      addBoxBeam(
        chassisFrameGroup,
        V3(sign * CHASSIS.mainRailX, 0.25, trailingPoint.z),
        V3(trailingPoint.x, trailingPoint.y, trailingPoint.z),
        0.055,
        0.08,
        materials.frame,
      );
      addBoxBeam(
        chassisFrameGroup,
        V3(sign * CHASSIS.sillRailX, 0.28, trailingPoint.z),
        V3(trailingPoint.x, trailingPoint.y, trailingPoint.z),
        0.045,
        0.065,
        materials.frame,
      );
      addClevisMount(chassisFrameGroup, trailingPoint, "x", {
        gap: 0.052,
        height: 0.105,
        span: 0.11,
        boltRadius: 0.01,
      });
    });

    /* Пороговые усилители и короткие аутригеры превращают две центральные
     балки в связанную силовую структуру кузова, сохраняя открытый обзор. */
    [-1, 1].forEach((sign) => {
      addBoxBeam(
        chassisFrameGroup,
        V3(sign * CHASSIS.sillRailX, 0.28, -0.82),
        V3(sign * CHASSIS.sillRailX, 0.28, 0.78),
        0.078,
        0.1,
        railMat,
      );
      [-0.78, -0.05, 0.7].forEach((z) => {
        addBoxBeam(
          chassisFrameGroup,
          V3(sign * CHASSIS.mainRailX, 0.22, z),
          V3(sign * CHASSIS.sillRailX, 0.28, z),
          0.05,
          0.075,
          materials.subframeAluminum,
        );
      });
    });

    /* Четыре точки каждого подрамника теперь заканчиваются в силовых чашках
     лонжеронов кузова; вертикальные болты физически входят в них. */
    [
      { axleZ: CHASSIS.frontAxleZ, offsets: [-0.18, 0.18] },
      {
        axleZ: CHASSIS.rearAxleZ,
        /* Чашки берутся из тех же данных, что и опоры подрамника,
         иначе болт уходит в воздух при любом сдвиге точки. */
        offsets: CHASSIS.rearSubframe.bodyMounts.map((m) => m.z),
      },
    ].forEach(({ axleZ, offsets }) => {
      [-1, 1].forEach((sign) => {
        offsets.forEach((zOffset) => {
          addBodyMountReceiver(
            chassisFrameGroup,
            sign * CHASSIS.mainRailX,
            axleZ + zOffset,
          );
        });
      });
    });

    const crossmemberZs = [-1.65, -0.85, 0.15, 0.85, 1.65];
    crossmemberZs.forEach((z) => {
      const cmGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.96, 12);
      const cm = new THREE.Mesh(cmGeo, materials.subframeAluminum);
      cm.rotation.z = Math.PI / 2;
      cm.position.set(0, z > 1.4 ? 0.5 : 0.2, z);
      cm.castShadow = true;
      chassisFrameGroup.add(cm);
    });

    const hoopGeo = new THREE.TorusGeometry(0.12, 0.02, 8, 20, Math.PI);
    const hoop = new THREE.Mesh(hoopGeo, materials.subframeAluminum);
    hoop.position.set(0, 0.2, 0.15);
    hoop.rotation.x = Math.PI;
    chassisFrameGroup.add(hoop);

    const bumperGeo = new THREE.BoxGeometry(1.2, 0.05, 0.05);
    const bumper = new THREE.Mesh(bumperGeo, railMat);
    bumper.position.set(0, 0.22, -1.7);
    chassisFrameGroup.add(bumper);
  }
  bootProgress(24, "Рама и стаканы стоек");
  await nextFrame();
  buildChassisFrame();

  /* 2. AUTHENTIC VW SCIROCCO (PQ35) SUBFRAME WITH REAR ALUMINUM CONSOLES */
  let frontSubframeMeshGroup, rearSubframeMeshGroup;
  let frontSwayAssembly = null;

  function buildSubframes() {
    frontSubframeMeshGroup = new THREE.Group();
    frontSubframeMeshGroup.position.set(
      0,
      CHASSIS.frontSubframe.nominalY,
      CHASSIS.frontAxleZ,
    );
    frontSubframeGroup.add(frontSubframeMeshGroup);

    /* ══ ПОДРАМНИК 1K0 199 369 F: ЗАМКНУТАЯ РАМА, А НЕ ПЛИТА ══
     Два лонжерона проходят рядом с осями сайлентблоков рычага,
     спереди и сзади их связывают поперечины, а середина ОТКРЫТА —
     там идут стабилизатор, приёмная труба и опора КПП. */
    const SUB_RAIL_X = 0.355;

    [-1, 1].forEach((s) => {
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(0.075, 0.075, 0.5),
        materials.subframeAluminum,
      );
      rail.position.set(s * SUB_RAIL_X, 0.012, 0);
      rail.castShadow = true;
      frontSubframeMeshGroup.add(rail);

      /* Выносы к четырём точкам крепления на лонжеронах кузова */
      [-0.18, 0.18].forEach((bz) => {
        const outrigger = new THREE.Mesh(
          new THREE.BoxGeometry(0.12, 0.055, 0.09),
          materials.subframeAluminum,
        );
        outrigger.position.set(s * 0.41, 0.02, bz);
        frontSubframeMeshGroup.add(outrigger);
      });
    });

    const subFrontCross = new THREE.Mesh(
      new THREE.BoxGeometry(0.71, 0.06, 0.075),
      materials.subframeAluminum,
    );
    subFrontCross.position.set(0, 0.012, -0.215);
    subFrontCross.castShadow = true;
    frontSubframeMeshGroup.add(subFrontCross);

    /* Задняя поперечина: сверху опора КПП, снизу втулки стабилизатора */
    const subRearCross = new THREE.Mesh(
      new THREE.BoxGeometry(0.71, 0.07, 0.095),
      materials.subframeAluminum,
    );
    subRearCross.position.set(0, 0.012, 0.21);
    subRearCross.castShadow = true;
    frontSubframeMeshGroup.add(subRearCross);

    [
      [-0.45, 0.18],
      [0.45, 0.18],
      [-0.45, -0.18],
      [0.45, -0.18],
    ].forEach(([bx, bz]) => {
      const bushingGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.08, 12);
      const bushing = new THREE.Mesh(bushingGeo, materials.bushingRubber);
      bushing.position.set(bx, 0.04, bz);
      frontSubframeMeshGroup.add(bushing);

      const m14Bolt = createHexBoltMesh(0.014, 0.09);
      m14Bolt.rotation.x = Math.PI / 2;
      m14Bolt.position.set(bx, 0.08, bz);
      frontSubframeMeshGroup.add(m14Bolt);
    });

    /* Кронштейны нижнего рычага стоят РОВНО там, где его сайлентблоки:
     передний — вилка с продольным болтом (z = -0.14),
     задний — консоль 1K0 199 231 с вертикальной запрессовкой (z = +0.14). */
    [-1, 1].forEach((s) => {
      const bx = s * 0.4;

      [-0.042, 0.042].forEach((ez) => {
        const ear = new THREE.Mesh(
          new THREE.BoxGeometry(0.075, 0.105, 0.014),
          materials.consoleBracket,
        );
        ear.position.set(bx, -0.022, -0.14 + ez);
        ear.castShadow = true;
        frontSubframeMeshGroup.add(ear);
      });

      const armFrontBolt = createHexBoltMesh(0.01, 0.115);
      armFrontBolt.position.set(bx, 0, -0.14);
      frontSubframeMeshGroup.add(armFrontBolt);

      const armConsole = new THREE.Mesh(
        new THREE.BoxGeometry(0.1, 0.095, 0.115),
        materials.consoleBracket,
      );
      armConsole.position.set(bx, -0.03, 0.14);
      armConsole.castShadow = true;
      frontSubframeMeshGroup.add(armConsole);

      const armConsoleBore = new THREE.Mesh(
        new THREE.CylinderGeometry(0.031, 0.031, 0.1, 14),
        materials.cvBoots,
      );
      armConsoleBore.position.set(bx, -0.01, 0.14);
      frontSubframeMeshGroup.add(armConsoleBore);

      const armRearBolt = createHexBoltMesh(0.01, 0.075);
      armRearBolt.rotation.x = Math.PI / 2;
      armRearBolt.position.set(bx, -0.075, 0.14);
      frontSubframeMeshGroup.add(armRearBolt);
    });

    [
      [-0.22, 0.05],
      [0.22, 0.05],
      [-0.22, -0.05],
      [0.22, -0.05],
    ].forEach(([rx, rz]) => {
      const rBoss = new THREE.Mesh(
        new THREE.CylinderGeometry(0.022, 0.022, 0.04, 10),
        materials.bracket,
      );
      rBoss.position.set(rx, 0.04, rz);
      frontSubframeMeshGroup.add(rBoss);

      const rBolt = createHexBoltMesh(0.009, 0.045);
      rBolt.position.set(rx, 0.06, rz);
      frontSubframeMeshGroup.add(rBolt);
    });

    /* ══ ЗАДНИЙ ПОДРАМНИК: ОТКРЫТАЯ ПРОСТРАНСТВЕННАЯ ЛЮЛЬКА ══
     Вместо условной прямоугольной плиты — две продольные балки, поперечины,
     аутригеры кузовных опор и отдельные кронштейны в каждой расчётной точке
     многорычажки. */
    rearSubframeMeshGroup = new THREE.Group();
    rearSubframeMeshGroup.position.set(
      0,
      CHASSIS.rearSubframe.nominalY,
      CHASSIS.rearAxleZ,
    );
    rearSubframeGroup.add(rearSubframeMeshGroup);

    const rearRailX = 0.35;
    [-1, 1].forEach((sign) => {
      const sideRail = new THREE.Mesh(
        new THREE.BoxGeometry(0.085, 0.075, 0.5),
        materials.subframeAluminum,
      );
      sideRail.position.set(sign * rearRailX, 0.018, 0.01);
      sideRail.castShadow = true;
      rearSubframeMeshGroup.add(sideRail);

      CHASSIS.rearSubframe.bodyMounts.forEach((mountPoint) => {
        /* Опора может стоять за торцом боковины — прижимаем старт балки. */
        const startZ = Math.min(0.22, Math.max(-0.22, mountPoint.z));
        addBoxBeam(
          rearSubframeMeshGroup,
          V3(sign * rearRailX, 0.018, startZ),
          V3(sign * mountPoint.x, mountPoint.y, mountPoint.z),
          0.06,
          0.075,
          materials.subframeAluminum,
        );
      });
    });

    const rearFrontCross = new THREE.Mesh(
      new THREE.BoxGeometry(0.72, 0.07, 0.085),
      materials.subframeAluminum,
    );
    rearFrontCross.position.set(0, 0.015, -0.205);
    rearFrontCross.castShadow = true;
    rearSubframeMeshGroup.add(rearFrontCross);

    const rearCenterCross = new THREE.Mesh(
      new THREE.BoxGeometry(0.63, 0.06, 0.075),
      materials.subframeAluminum,
    );
    rearCenterCross.position.set(0, -0.015, 0.03);
    rearCenterCross.castShadow = true;
    rearSubframeMeshGroup.add(rearCenterCross);

    const rearBackCross = new THREE.Mesh(
      new THREE.BoxGeometry(0.69, 0.07, 0.085),
      materials.subframeAluminum,
    );
    rearBackCross.position.set(0, 0.025, 0.215);
    rearBackCross.castShadow = true;
    rearSubframeMeshGroup.add(rearBackCross);

    [-1, 1].forEach((sign) => {
      CHASSIS.rearSubframe.bodyMounts.forEach((mountPoint) => {
        const bx = sign * mountPoint.x;
        const bushing = new THREE.Mesh(
          new THREE.CylinderGeometry(0.035, 0.035, 0.08, SEG(14, 9)),
          materials.bushingRubber,
        );
        bushing.position.set(bx, mountPoint.y, mountPoint.z);
        bushing.castShadow = true;
        rearSubframeMeshGroup.add(bushing);

        const m14Bolt = createHexBoltMesh(0.014, 0.09);
        m14Bolt.rotation.x = Math.PI / 2;
        m14Bolt.position.set(bx, 0.08, mountPoint.z);
        rearSubframeMeshGroup.add(m14Bolt);
      });

      const hp = CHASSIS.rearSubframe.hardpoints;
      /* Шарниры вынесены на боковину подрамника (x = 0.40), и все
       кронштейнные балки идут от шарнира только ВНУТРЬ. Снаружи
       остаётся пустой коридор — там качается рычаг. */
      const mounts = [
        {
          name: "upperArm",
          point: hp.upperArm,
          anchors: [
            V3(sign * rearRailX, 0.055, -0.06),
            V3(sign * rearRailX, 0.03, 0.075),
          ],
        },
        {
          name: "springLink",
          point: hp.springLink,
          anchors: [
            V3(sign * rearRailX, 0.018, 0.026),
            V3(sign * rearRailX, 0.018, 0.1),
          ],
        },
        {
          name: "camberLink",
          point: hp.camberLink,
          anchors: [
            V3(sign * rearRailX, 0.04, 0.16),
            V3(sign * rearRailX, 0.028, 0.09),
          ],
        },
        {
          name: "toeLink",
          point: hp.toeLink,
          anchors: [
            V3(sign * rearRailX, 0.055, 0.22),
            V3(sign * rearRailX, 0.04, 0.14),
          ],
        },
      ];

      mounts.forEach(({ name, point, anchors }) => {
        const hardpoint = V3(sign * point.x, point.y, point.z);
        const clevis = addClevisMount(rearSubframeMeshGroup, hardpoint, "z", {
          gap: 0.052,
          height: name === "upperArm" ? 0.105 : 0.09,
          span:
              name === "upperArm" ? 0.07 : name === "toeLink" ? 0.075 : 0.085,
          boltRadius: 0.009,
        });
        clevis.userData.hardpoint = name;
        anchors.forEach((anchor) => {
          addBoxBeam(
            rearSubframeMeshGroup,
            anchor,
            hardpoint,
            0.042,
            0.052,
            materials.subframeAluminum,
          );
        });
      });
    });
  }
  bootProgress(33, "Подрамники PQ35");
  await nextFrame();
  buildSubframes();

  /* 3. STEERING SYSTEM */
  let steeringRackBar,
    leftTieRodAssembly,
    rightTieRodAssembly,
    steeringColumnShaft;
  const steeringRackBoots = [];

  function buildSteering() {
    const steerBase = new THREE.Group();
    steerBase.position.set(0, 0.18, -1.25);
    steeringGroup.add(steerBase);

    const rackHousingGeo = new THREE.CylinderGeometry(0.038, 0.038, 0.54, 12);
    const rackHousing = new THREE.Mesh(rackHousingGeo, materials.steeringRack);
    rackHousing.rotation.z = Math.PI / 2;
    steerBase.add(rackHousing);

    const motorBulgeGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.14, 12);
    const motorBulge = new THREE.Mesh(motorBulgeGeo, materials.steeringRack);
    motorBulge.position.set(-0.12, 0.04, 0);
    steerBase.add(motorBulge);

    const rackBarGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.72, 10);
    steeringRackBar = new THREE.Mesh(rackBarGeo, materials.steeringShaft);
    steeringRackBar.rotation.z = Math.PI / 2;
    steerBase.add(steeringRackBar);

    /* Гофры рейки: закрывают шток от корпуса до шарнира рулевой тяги,
     поэтому их длина меняется вместе с ходом штока (см. updateSimulation) */
    [-0.28, 0.28].forEach((bx) => {
      const bootGeo = new THREE.CylinderGeometry(0.032, 0.032, 0.12, 10);
      const boot = new THREE.Mesh(bootGeo, materials.cvBoots);
      boot.rotation.z = Math.PI / 2;
      boot.position.x = bx;
      steerBase.add(boot);
      steeringRackBoots.push(boot);
    });

    function createTieRodAssembly(isLeft) {
      const group = new THREE.Group();
      steeringGroup.add(group);

      const sign = isLeft ? -1 : 1;

      const innerJointGeo = new THREE.SphereGeometry(0.022, 10, 10);
      const innerJoint = new THREE.Mesh(
        innerJointGeo,
        materials.ballJointSteel,
      );
      innerJoint.position.set(sign * 0.36, 0.18, -1.25);
      group.add(innerJoint);

      const rodGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.36, 8);
      const rod = new THREE.Mesh(rodGeo, materials.steeringTieRod);
      rod.position.set(sign * 0.54, 0.18, -1.25);
      rod.rotation.z = (sign * Math.PI) / 2;
      group.add(rod);

      const outerEndGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.05, 10);
      const outerEnd = new THREE.Mesh(
        outerEndGeo,
        materials.ballJointSteel,
      );
      outerEnd.position.set(sign * 0.72, 0.18, -1.25);
      outerEnd.rotation.x = Math.PI / 2;
      group.add(outerEnd);

      const castleNut = createHexBoltMesh(0.008, 0.025);
      castleNut.position.set(sign * 0.72, 0.15, -1.25);
      group.add(castleNut);

      return { group, innerJoint, rod, outerEnd, castleNut, isLeft };
    }

    leftTieRodAssembly = createTieRodAssembly(true);
    rightTieRodAssembly = createTieRodAssembly(false);

    const colGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.45, 10);
    steeringColumnShaft = new THREE.Mesh(colGeo, materials.ujoint);
    steeringColumnShaft.position.set(-0.15, 0.34, -1.15);
    steeringColumnShaft.rotation.x = -0.6;
    steeringColumnShaft.rotation.y = 0.2;
    steeringGroup.add(steeringColumnShaft);
  }
  bootProgress(41, "Рулевая рейка и тяги");
  await nextFrame();
  buildSteering();

  /* 4. SUSPENSION: OEM VW SCIROCCO CONTROL ARM & 55MM STRUT CLAMP KNUCKLE */
  const suspensionCorners = [];

  function createCoilSpringGeometry(
    turns = 7,
    radius = 0.045,
    length = 0.28,
    tubeRadius = 0.007,
  ) {
    /* Прогрессивная навивка с поджатыми опорными витками */
    const points = [];
    const count = 190;
    for (let i = 0; i <= count; i++) {
      const t = i / count;
      const pitch = Math.pow(t, 1.18);
      const angle = pitch * turns * Math.PI * 2;
      const seat = Math.min(1, t / 0.07) * Math.min(1, (1 - t) / 0.07);
      const r = radius * (0.93 + 0.07 * seat);
      points.push(
        new THREE.Vector3(Math.cos(angle) * r, t * length, Math.sin(angle) * r),
      );
    }
    const curve = new THREE.CatmullRomCurve3(points);
    return new THREE.TubeGeometry(
      curve,
      isMobile ? 190 : 280,
      tubeRadius,
      isMobile ? 8 : 12,
      false,
    );
  }

  function createSciroccoControlArm(sign) {
    const group = new THREE.Group();
    const L = 0.3533;

    const fSleeve = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, 0.055, 14),
      materials.bushingRubber,
    );
    fSleeve.position.set(0, 0, 0.14);
    group.add(fSleeve);

    const rHexPin = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.02, 0.06, 6),
      materials.controlArmAluminum,
    );
    rHexPin.position.set(0, 0, -0.14);
    rHexPin.rotation.x = Math.PI / 2;
    group.add(rHexPin);

    const mainWeb = new THREE.Mesh(
      new THREE.BoxGeometry(L, 0.022, 0.08),
      materials.controlArmAluminum,
    );
    mainWeb.position.set(sign * (L * 0.5), 0, 0);
    mainWeb.castShadow = true;
    group.add(mainWeb);

    const fDiagonal = new THREE.Mesh(
      new THREE.CylinderGeometry(0.016, 0.016, 0.36, 8),
      materials.controlArmAluminum,
    );
    fDiagonal.position.set(sign * (L * 0.5), 0, 0.07);
    fDiagonal.rotation.z = (sign * Math.PI) / 2;
    fDiagonal.rotation.y = -sign * 0.38;
    group.add(fDiagonal);

    const rDiagonal = new THREE.Mesh(
      new THREE.CylinderGeometry(0.016, 0.016, 0.36, 8),
      materials.controlArmAluminum,
    );
    rDiagonal.position.set(sign * (L * 0.5), 0, -0.07);
    rDiagonal.rotation.z = (sign * Math.PI) / 2;
    rDiagonal.rotation.y = sign * 0.38;
    group.add(rDiagonal);

    const padGeo = new THREE.BoxGeometry(0.06, 0.025, 0.08);
    const padMesh = new THREE.Mesh(padGeo, materials.controlArmAluminum);
    padMesh.position.set(sign * L, 0, 0);
    group.add(padMesh);

    // 3-BOLT BALL JOINT (1K0 407 365)
    const ballJointGroup = new THREE.Group();
    ballJointGroup.position.set(sign * L, 0, 0);

    const bjPlate = new THREE.Mesh(
      new THREE.BoxGeometry(0.065, 0.01, 0.085),
      materials.ballJointSteel,
    );
    ballJointGroup.add(bjPlate);

    [
      [0, 0.03],
      [-0.02, -0.025],
      [0.02, -0.025],
    ].forEach(([px, pz]) => {
      const bjNut = createHexBoltMesh(0.007, 0.035);
      bjNut.position.set(px, 0.015, pz);
      ballJointGroup.add(bjNut);
    });

    const bjHousing = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, 0.028, 12),
      materials.ballJointSteel,
    );
    bjHousing.position.set(sign * 0.02, 0.02, 0);
    ballJointGroup.add(bjHousing);

    const bjRubberBoot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.024, 0.02, 10),
      materials.cvBoots,
    );
    bjRubberBoot.position.set(sign * 0.02, 0.04, 0);
    ballJointGroup.add(bjRubberBoot);

    const taperedBallStud = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.01, 0.035, 10),
      materials.ballJointSteel,
    );
    taperedBallStud.position.set(sign * 0.02, 0.06, 0);
    ballJointGroup.add(taperedBallStud);

    group.add(ballJointGroup);

    return { armGroup: group, ballJointGroup };
  }

  function createSciroccoMacPhersonStrut(sign) {
    const strutGroup = new THREE.Group();

    /* ОПОРНЫЙ ПОДШИПНИК 1K0 412 331.
     Наружная обойма запрессована в стакан кузова и НЕ вращается,
     внутреннее кольцо крутится вместе со штоком, пружиной и цапфой.
     Поэтому bearingOuter живёт вне strutGroup (его ставит cornerGroup). */
    const bearingOuter = new THREE.Mesh(
      new THREE.CylinderGeometry(0.074, 0.074, 0.024, SEG(20, 12)),
      materials.consoleBracket,
    );
    bearingOuter.castShadow = true;

    const bearingInner = new THREE.Mesh(
      new THREE.CylinderGeometry(0.052, 0.052, 0.02, SEG(20, 12)),
      materials.hubWheelBearing,
    );
    bearingInner.position.y = 0.515;
    strutGroup.add(bearingInner);

    const topMount = new THREE.Mesh(
      new THREE.CylinderGeometry(0.062, 0.062, 0.04, 16),
      materials.consoleBracket,
    );
    topMount.position.y = 0.54;
    strutGroup.add(topMount);

    /* Верхняя тарелка пружины: вращается со штоком, поджимает верхний виток */
    const upperSeat = new THREE.Mesh(
      new THREE.CylinderGeometry(0.066, 0.066, 0.014, SEG(18, 10)),
      materials.springSeat,
    );
    upperSeat.position.y = 0.465;
    strutGroup.add(upperSeat);

    const pistonRod = new THREE.Mesh(
      new THREE.CylinderGeometry(0.011, 0.011, 0.32, 12),
      materials.damperShaft,
    );
    pistonRod.position.y = 0.38;
    strutGroup.add(pistonRod);

    /* ОТБОЙНИК (Anschlagpuffer) на штоке — упирается в верх корпуса стойки
     на ходе сжатия; сжимается ровно на bumpHit из расчёта сил */
    const bumpStop = new THREE.Mesh(
      new THREE.CylinderGeometry(0.024, 0.029, 0.075, SEG(14, 8)),
      materials.cvBoots,
    );
    bumpStop.position.y = 0.34;
    strutGroup.add(bumpStop);

    /* Гофрированный пыльник штока: длина = открытая часть штока */
    const dustBoot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.034, 0.034, 0.18, SEG(14, 8)),
      materials.cvBoots,
    );
    dustBoot.position.y = 0.25;
    strutGroup.add(dustBoot);

    const springMesh = new THREE.Mesh(
      createCoilSpringGeometry(7, 0.052, 0.32, 0.008),
      materials.mcphersonSpring,
    );
    springMesh.position.y = 0.16;
    strutGroup.add(springMesh);

    const lowerSpringPerch = new THREE.Mesh(
      new THREE.CylinderGeometry(0.068, 0.068, 0.015, 16),
      materials.springSeat,
    );
    lowerSpringPerch.position.y = 0.16;
    strutGroup.add(lowerSpringPerch);

    const strutBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0275, 0.0275, 0.28, 16),
      materials.mcphersonStrut,
    );
    strutBody.position.y = 0.02;
    strutGroup.add(strutBody);

    const swayBracket = new THREE.Mesh(
      new THREE.BoxGeometry(0.022, 0.034, 0.05),
      materials.swayBar,
    );
    swayBracket.position.set(0, 0.06, sign * 0.045);
    strutGroup.add(swayBracket);

    /* СТОЙКА СТАБИЛИЗАТОРА 1K0 411 315: тело постоянной длины 240 мм.
     Живёт в cornerGroup, потому что соединяет ДВЕ разные детали —
     плечо штанги на подрамнике и кронштейн на амортизаторной стойке. */
    const dropLinkRod = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.008, 0.33, SEG(10, 6)),
      materials.swayBar,
    );
    dropLinkRod.castShadow = true;

    return {
      strutGroup,
      topMount,
      pistonRod,
      springMesh,
      strutBody,
      lowerSpringPerch,
      bearingOuter,
      bearingInner,
      upperSeat,
      bumpStop,
      dustBoot,
      swayBracket,
      dropLinkRod,
    };
  }

  /* ЦАПФА / ПОВОРОТНЫЙ КУЛАК 1K0 407 255 — литой корпус со ступичным гнездом */
  function createSciroccoKnuckle(sign, isFront) {
    const knuckleGroup = new THREE.Group();
    const CI = materials.knuckleCastIron;
    const put = (m, x, y, z, shadow) => {
      m.position.set(x, y, z);
      if (shadow !== false) m.castShadow = true;
      knuckleGroup.add(m);
      return m;
    };

    /* Гнездо ступичного подшипника (внутрь от тормозного щита) */
    const hubBoss = new THREE.Mesh(
      new THREE.CylinderGeometry(0.062, 0.062, 0.075, 30),
      CI,
    );
    hubBoss.rotation.z = Math.PI / 2;
    put(hubBoss, -sign * 0.08, 0, 0);

    const hubFlange = new THREE.Mesh(
      new THREE.CylinderGeometry(0.082, 0.074, 0.016, 30),
      CI,
    );
    hubFlange.rotation.z = Math.PI / 2;
    put(hubFlange, -sign * 0.121, 0, 0);

    /* Четыре болта ступичного узла 1T0 498 621 */
    [
      [0.048, 0.048],
      [-0.048, 0.048],
      [0.048, -0.048],
      [-0.048, -0.048],
    ].forEach(([by, bz]) => {
      const bBolt = createHexBoltMesh(0.0075, 0.028);
      bBolt.rotation.y = (-sign * Math.PI) / 2;
      put(bBolt, -sign * 0.133, by, bz);
    });

    /* Литая стойка вверх к хомуту амортизатора */
    const upperLeg = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.048, isFront ? 0.125 : 0.088, 4),
      CI,
    );
    upperLeg.geometry.rotateY(Math.PI / 4);
    upperLeg.scale.set(0.72, 1, 1);
    upperLeg.rotation.z = sign * 0.22;
    put(upperLeg, -sign * 0.094, isFront ? 0.076 : 0.05, isFront ? 0 : -0.022);

    /* Разрезной хомут стойки Ø55 мм — ТОЛЬКО передняя ось: на задней стойки
     нет, и вместо хомута цапфа несёт проушины рычагов */
    let pinchBolt = null;
    if (isFront) {
      const clampCollar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.038, 0.038, 0.09, 24),
        CI,
      );
      put(clampCollar, -sign * 0.105, 0.14, 0);

      const clampBore = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0295, 0.0295, 0.094, 20, 1, true),
        materials.rimInner,
      );
      put(clampBore, -sign * 0.105, 0.14, 0, false);

      [-0.016, 0.016].forEach((ex) => {
        const ear = new THREE.Mesh(
          new THREE.BoxGeometry(0.02, 0.056, 0.034),
          CI,
        );
        put(ear, -sign * 0.105 + ex, 0.14, -0.048);
      });

      pinchBolt = createHexBoltMesh(0.01, 0.064);
      pinchBolt.rotation.y = Math.PI / 2;
      put(pinchBolt, -sign * 0.105, 0.14, -0.048);
    }

    /* Нижняя лапа и гнездо шаровой опоры 1K0 407 365 */
    const lowerLeg = new THREE.Mesh(
      new THREE.CylinderGeometry(0.046, 0.028, 0.1, 4),
      CI,
    );
    lowerLeg.geometry.rotateY(Math.PI / 4);
    lowerLeg.scale.set(0.78, 1, 1);
    lowerLeg.rotation.z = sign * 0.34;
    put(lowerLeg, -sign * 0.055, -0.062, 0);

    if (isFront) {
      const bjSocket = new THREE.Mesh(
        new THREE.CylinderGeometry(0.029, 0.033, 0.044, 20),
        CI,
      );
      put(bjSocket, -sign * 0.04, -0.104, 0);

      const lowerLockNut = createHexBoltMesh(0.011, 0.022);
      put(lowerLockNut, -sign * 0.04, -0.128, 0);
    }

    /* Рулевой рычаг с конусным гнездом наконечника */
    if (isFront) {
      const steerArm = new THREE.Mesh(
        new THREE.CylinderGeometry(0.02, 0.034, 0.13, 4),
        CI,
      );
      steerArm.geometry.rotateY(Math.PI / 4);
      steerArm.scale.set(0.82, 1, 1);
      steerArm.rotation.x = Math.PI / 2;
      steerArm.rotation.z = sign * 0.19;
      put(steerArm, -sign * 0.013, -0.048, 0.068);

      const tieRodEye = new THREE.Mesh(
        new THREE.CylinderGeometry(0.022, 0.022, 0.036, 18),
        CI,
      );
      put(tieRodEye, -sign * 0.025, -0.045, 0.115);

      const tieRodTaperedHole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.012, 0.012, 0.052, 14),
        materials.bolt,
      );
      put(tieRodTaperedHole, -sign * 0.025, -0.045, 0.115, false);

      const castleNut = createHexBoltMesh(0.011, 0.02);
      castleNut.rotation.x = Math.PI / 2;
      put(castleNut, -sign * 0.025, -0.072, 0.115);
    }

    /* ── ЗАДНЯЯ ЦАПФА PQ35 ──
     Сзади нет ни стойки, ни шаровой опоры: цапфа держит пять рычагов через
     проушины с сайлентблоками и вилку нижней опоры амортизатора. Точки —
     из CHASSIS.rearCarrier, то есть ровно те, по которым решается
     кинематика, поэтому звено физически не может уйти «в воздух». */
    if (!isFront) {
      const RC = CHASSIS.rearCarrier;
      const _cA = new THREE.Vector3();
      const _cDir = new THREE.Vector3();
      const _cUp = new THREE.Vector3(0, 1, 0);
      const at = (loc) => new THREE.Vector3(sign * loc[0], loc[1], loc[2]);

      /* Ребро литья между двумя точками цапфы */
      const web = (from, to, w, d) => {
        _cA.subVectors(to, from);
        const len = Math.max(0.02, _cA.length());
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, len, d), CI);
        m.position.copy(from).addScaledVector(_cA, 0.5);
        m.quaternion.setFromUnitVectors(_cUp, _cDir.copy(_cA).normalize());
        m.castShadow = true;
        knuckleGroup.add(m);
      };

      /* Проушина шарнира: стальная обойма, резиновая втулка, болт насквозь */
      const jointEar = (pt, axis, rOut, width) => {
        const boss = new THREE.Mesh(
          new THREE.CylinderGeometry(rOut, rOut, width, SEG(18, 12)),
          materials.ballJointSteel,
        );
        const sleeve = new THREE.Mesh(
          new THREE.CylinderGeometry(
            rOut * 0.58,
            rOut * 0.58,
            width * 1.18,
            SEG(14, 9),
          ),
          materials.bushingRubber,
        );
        const bolt = createHexBoltMesh(rOut * 0.33, width * 1.7);
        if (axis === "z") {
          boss.rotation.x = Math.PI / 2;
          sleeve.rotation.x = Math.PI / 2;
        } else if (axis === "x") {
          boss.rotation.z = Math.PI / 2;
          sleeve.rotation.z = Math.PI / 2;
          bolt.rotation.y = Math.PI / 2;
        } else {
          bolt.rotation.x = Math.PI / 2;
        }
        put(boss, pt.x, pt.y, pt.z);
        put(sleeve, pt.x, pt.y, pt.z, false);
        put(bolt, pt.x, pt.y, pt.z, false);
      };

      const upEar = at(RC.upOut);
      const splEar = at(RC.splOut);
      const camEar = at(RC.camOut);
      const toeEar = at(RC.toeOut);
      const trEar = at(RC.trOut);
      const core = new THREE.Vector3(-sign * 0.085, -0.01, 0.01);

      /* Стенка от верхней проушины к нижней плюс рога к остальным точкам */
      web(upEar, splEar, 0.05, 0.07);
      web(core, camEar, 0.042, 0.05);
      web(core, toeEar, 0.038, 0.046);
      web(core, trEar, 0.05, 0.058);

      jointEar(upEar, "z", 0.026, 0.05);
      jointEar(splEar, "z", 0.03, 0.058);
      jointEar(camEar, "z", 0.024, 0.05);
      jointEar(toeEar, "y", 0.022, 0.046);
      jointEar(trEar, "x", 0.032, 0.064);

    }

    /* Уши крепления суппорта — по касательной к диску */
    const calMountGroup = new THREE.Group();
    calMountGroup.position.set(0, 0.104, -0.08);
    calMountGroup.rotation.x = -0.656;
    knuckleGroup.add(calMountGroup);

    [-0.054, 0.054].forEach((tz) => {
      const ear = new THREE.Mesh(
        new THREE.BoxGeometry(0.028, 0.032, 0.036),
        CI,
      );
      ear.position.set(-sign * 0.02, 0, tz);
      ear.castShadow = true;
      calMountGroup.add(ear);

      const eBolt = createHexBoltMesh(0.008, 0.032);
      eBolt.rotation.y = Math.PI / 2;
      eBolt.position.set(-sign * 0.04, 0, tz);
      calMountGroup.add(eBolt);
    });

    /* Рёбра жёсткости литья */
    [1, -1].forEach((rs) => {
      const rib = new THREE.Mesh(
        new THREE.BoxGeometry(0.012, 0.085, 0.014),
        CI,
      );
      rib.rotation.x = rs * 0.42;
      put(rib, -sign * 0.07, rs * 0.05, 0.048);
    });

    /* Датчик ABS в приливе цапфы */
    const absSensor = new THREE.Mesh(
      new THREE.CylinderGeometry(0.01, 0.01, 0.052, 12),
      materials.cvBoots,
    );
    absSensor.rotation.x = 0.45;
    put(absSensor, -sign * 0.062, 0.054, 0.062, false);

    /* Шейка под сальник ступицы */
    const spindleShaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.028, 0.028, 0.085, 20),
      materials.bolt,
    );
    spindleShaft.rotation.z = Math.PI / 2;
    put(spindleShaft, -sign * 0.05, 0, 0, false);

    return { knuckleGroup, spindleShaft, pinchBolt };
  }

  /* ─── ГЕОМЕТРИЧЕСКИЕ ХЕЛПЕРЫ ДЛЯ СТЕРЖНЕВЫХ ЗВЕНЬЕВ ─── */
  const _rodA = new THREE.Vector3();
  const _rodB = new THREE.Vector3();
  const _rodUp = new THREE.Vector3(0, 1, 0);
  const _ptPool = [];
  for (let i = 0; i < 16; i++) _ptPool.push(new THREE.Vector3());
  const P = (i, x, y, z) => _ptPool[i].set(x, y, z);

  /* Ставит стержень между двумя точками: геометрия ориентирована по локальной +Y */
  function aimRod(mesh, from, to, baseLen) {
    _rodA.subVectors(to, from);
    const len = Math.max(0.02, _rodA.length());
    mesh.position.copy(from).addScaledVector(_rodA, 0.5);
    _rodB.copy(_rodA).normalize();
    mesh.quaternion.setFromUnitVectors(_rodUp, _rodB);
    mesh.scale.set(1, len / baseLen, 1);
    return len;
  }

  /* Ставит группу началом в точку from, локальная +Y смотрит на to */
  function aimGroup(group, from, to) {
    _rodA.subVectors(to, from);
    const len = Math.max(0.02, _rodA.length());
    group.position.copy(from);
    _rodB.copy(_rodA).normalize();
    group.quaternion.setFromUnitVectors(_rodUp, _rodB);
    return len;
  }

  /* ─── ЗАДНЯЯ МНОГОРЫЧАЖКА PQ35 ───
   Продольный рычаг (Längslenker) держит продольные силы, три поперечных рычага задают
   развал, тяга с эксцентриком — сходимость. Пружина стоит на нижнем рычаге
   (Federlenker) отдельно от амортизатора — именно поэтому пол багажника низкий. */
  function createPQ35RearMultilink(sign) {
    const group = new THREE.Group();

    function rodMesh(radius, len, mat) {
      const m = new THREE.Mesh(
        new THREE.CylinderGeometry(radius, radius, len, SEG(12, 8)),
        mat,
      );
      m.castShadow = true;
      group.add(m);
      return { mesh: m, base: len };
    }

    function boxRod(w, len, d, mat) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, len, d), mat);
      m.castShadow = true;
      group.add(m);
      return { mesh: m, base: len };
    }

    const trailingArm = boxRod(0.052, 0.42, 0.095, materials.rearLinkAluminum);
    const upperArm = rodMesh(0.019, 0.34, materials.rearLinkAluminum);
    const springLink = boxRod(0.05, 0.4, 0.072, materials.rearLinkAluminum);
    const camberLink = rodMesh(0.014, 0.36, materials.rearLinkAluminum);
    const toeLink = rodMesh(0.015, 0.34, materials.rearLinkAluminum);

    /* Сайлентблоки внутренних шарниров: 0..3 — к подрамнику, 4 — продольный рычаг к кузову */
    const bushes = [];
    for (let i = 0; i < 5; i++) {
      const b = new THREE.Mesh(
        new THREE.CylinderGeometry(0.027, 0.027, 0.048, SEG(12, 8)),
        materials.bushingRubber,
      );
      if (i < 4) {
        b.rotation.x = Math.PI / 2;
      } else {
        b.rotation.z = Math.PI / 2;
      }
      group.add(b);
      bushes.push(b);
    }

    /* Эксцентрик регулировки сходимости */
    const toeCam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.031, 0.031, 0.02, SEG(14, 9)),
      materials.bolt,
    );
    toeCam.rotation.x = Math.PI / 2;
    group.add(toeCam);

    /* Пружина на нижнем рычаге с отдельными чашками */
    const springGroup = new THREE.Group();
    group.add(springGroup);

    const springMesh = new THREE.Mesh(
      createCoilSpringGeometry(6, 0.046, 0.36, 0.0075),
      materials.mcphersonSpring,
    );
    springGroup.add(springMesh);

    const springSeat = new THREE.Mesh(
      new THREE.CylinderGeometry(0.058, 0.058, 0.012, SEG(16, 10)),
      materials.springSeat,
    );
    springGroup.add(springSeat);

    const springTopSeat = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 0.014, SEG(16, 10)),
      materials.springSeat,
    );
    springGroup.add(springTopSeat);

    /* Амортизатор без пружины */
    const damperGroup = new THREE.Group();
    group.add(damperGroup);

    const damperBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.024, 0.026, 0.24, SEG(14, 9)),
      materials.mcphersonStrut,
    );
    damperBody.position.y = 0.13;
    damperBody.castShadow = true;
    damperGroup.add(damperBody);

    const pistonRod = new THREE.Mesh(
      new THREE.CylinderGeometry(0.011, 0.011, 0.26, SEG(10, 7)),
      materials.damperShaft,
    );
    pistonRod.position.y = 0.32;
    damperGroup.add(pistonRod);

    const damperTopMount = new THREE.Mesh(
      new THREE.CylinderGeometry(0.042, 0.042, 0.032, SEG(14, 9)),
      materials.consoleBracket,
    );
    damperTopMount.position.y = 0.46;
    damperGroup.add(damperTopMount);

    const damperLowerEye = new THREE.Mesh(
      new THREE.CylinderGeometry(0.026, 0.026, 0.05, SEG(12, 8)),
      materials.ballJointSteel,
    );
    damperLowerEye.rotation.z = Math.PI / 2;
    damperGroup.add(damperLowerEye);

    /* Нижняя проушина сидит в вилке пружинного рычага: резиновый
     сайлентблок, две пластины и поперечный болт. Вилка едет вместе с
     амортизатором, потому что она и есть его посадка на рычаг. */
    const damperLowerBush = new THREE.Mesh(
      new THREE.CylinderGeometry(0.017, 0.017, 0.056, SEG(12, 8)),
      materials.bushingRubber,
    );
    damperLowerBush.rotation.z = Math.PI / 2;
    damperGroup.add(damperLowerBush);

    [-0.033, 0.033].forEach((fx) => {
      const clevisPlate = new THREE.Mesh(
        new THREE.BoxGeometry(0.012, 0.07, 0.044),
        materials.rearLinkAluminum,
      );
      clevisPlate.position.set(fx, -0.005, 0);
      clevisPlate.castShadow = true;
      damperGroup.add(clevisPlate);
    });

    const damperClevisPad = new THREE.Mesh(
      new THREE.BoxGeometry(0.086, 0.014, 0.05),
      materials.rearLinkAluminum,
    );
    damperClevisPad.position.y = -0.037;
    damperClevisPad.castShadow = true;
    damperGroup.add(damperClevisPad);

    const damperLowerBolt = createHexBoltMesh(0.011, 0.092);
    damperLowerBolt.rotation.y = Math.PI / 2;
    damperGroup.add(damperLowerBolt);

    return {
      group,
      sign,
      trailingArm,
      upperArm,
      springLink,
      camberLink,
      toeLink,
      bushes,
      toeCam,
      springGroup,
      springMesh,
      springSeat,
      springTopSeat,
      damperGroup,
      damperBody,
      pistonRod,
      damperTopMount,
      damperLowerEye,
    };
  }

  function buildSuspension() {
    const configs = [
      {
        name: "FL",
        isFront: true,
        isLeft: true,
        x: -0.78,
        z: CHASSIS.frontAxleZ,
      },
      {
        name: "FR",
        isFront: true,
        isLeft: false,
        x: 0.78,
        z: CHASSIS.frontAxleZ,
      },
      {
        name: "RL",
        isFront: false,
        isLeft: true,
        x: -0.78,
        z: CHASSIS.rearAxleZ,
      },
      {
        name: "RR",
        isFront: false,
        isLeft: false,
        x: 0.78,
        z: CHASSIS.rearAxleZ,
      },
    ];

    configs.forEach((cfg, idx) => {
      const cornerGroup = new THREE.Group();
      suspensionGroup.add(cornerGroup);

      const sign = cfg.isLeft ? -1 : 1;

      const lowerArmPivot = new THREE.Group();
      lowerArmPivot.position.set(
        sign * CHASSIS.front.lowerPivotX,
        CHASSIS.front.lowerPivotY,
        cfg.z,
      );
      cornerGroup.add(lowerArmPivot);

      /* L-образный рычаг 1K0407151 — только передняя ось; сзади стоит многорычажка */
      const armData = cfg.isFront ? createSciroccoControlArm(sign) : null;
      if (armData) lowerArmPivot.add(armData.armGroup);

      let strutAssembly = null;
      let rearLinks = null;
      if (cfg.isFront) {
        strutAssembly = createSciroccoMacPhersonStrut(sign);
        cornerGroup.add(strutAssembly.strutGroup);
        cornerGroup.add(strutAssembly.bearingOuter);
        cornerGroup.add(strutAssembly.dropLinkRod);
      } else {
        rearLinks = createPQ35RearMultilink(sign);
        cornerGroup.add(rearLinks.group);
      }

      const knuckleData = createSciroccoKnuckle(sign, cfg.isFront);
      knuckleData.knuckleGroup.position.set(cfg.x, 0.32, cfg.z);
      cornerGroup.add(knuckleData.knuckleGroup);

      suspensionCorners.push({
        id: idx,
        cfg,
        cornerGroup,
        lowerArmPivot,
        armData,
        strutAssembly,
        knuckleGroup: knuckleData.knuckleGroup,
        knuckleData,
        travelMm: 0,
        targetTravelMm: 0,
        steerAngleRad: 0,
        wheelRpm: 0,
        wheelAngle: 0,
        armSagZ: 0,
        strutSagZ: 0,
        knuckleFallY: 0,
        rearLinks,
        toeRad: 0,
      });
    });

    /* ═══ ПЕРЕДНИЙ СТАБИЛИЗАТОР 1K0 411 315 ═══
     Торсионная штанга в двух втулках подрамника, два плеча по краям и две
     стойки стабилизатора. Стойка — тело ПОСТОЯННОЙ длины, поэтому угол
     плеча не задаётся, а решается из положения амортизаторной стойки. */
    (function buildFrontArb() {
      const grp = new THREE.Group();
      frontSubframeGroup.add(grp);

      const barY = 0.085,
        barZ = -1.1,
        armX = 0.6,
        armR = 0.23,
        linkLen = 0.33;

      const barGroup = new THREE.Group();
      barGroup.position.set(0, barY, barZ);
      grp.add(barGroup);

      const bar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.016, 0.016, armX * 2, SEG(14, 8)),
        materials.swayBar,
      );
      bar.rotation.z = Math.PI / 2;
      bar.castShadow = true;
      barGroup.add(bar);

      /* Плечи штанги: каждое поворачивается вокруг оси штанги на свой угол,
       разница углов и есть закрутка стабилизатора */
      const arms = [];
      [-1, 1].forEach((s) => {
        const arm = new THREE.Group();
        arm.position.set(s * armX, barY, barZ);
        grp.add(arm);

        const rod = new THREE.Mesh(
          new THREE.CylinderGeometry(0.014, 0.014, armR, SEG(12, 8)),
          materials.swayBar,
        );
        rod.rotation.x = Math.PI / 2;
        rod.position.set(0, 0, -armR * 0.5);
        rod.castShadow = true;
        arm.add(rod);

        const eye = new THREE.Mesh(
          new THREE.SphereGeometry(0.018, SEG(12, 8), SEG(10, 6)),
          materials.ballJointSteel,
        );
        eye.position.set(0, 0, -armR);
        arm.add(eye);

        arms.push(arm);
      });

      /* Втулки крепления штанги к подрамнику — неподвижны */
      [-0.3, 0.3].forEach((bx) => {
        const bush = new THREE.Mesh(
          new THREE.BoxGeometry(0.062, 0.078, 0.062),
          materials.bushingRubber,
        );
        bush.position.set(bx, barY + 0.018, barZ);
        grp.add(bush);
      });

      frontSwayAssembly = {
        group: grp,
        barGroup,
        arms,
        links: [
          suspensionCorners[0].strutAssembly.dropLinkRod,
          suspensionCorners[1].strutAssembly.dropLinkRod,
        ],
        theta: [0, 0],
        barY,
        barZ,
        armX,
        armR,
        linkLen,
      };
    })();

    /* Задний стабилизатор: штанга по заднему подрамнику + стойки на рычаги пружин */
    const rearSwayGeo = new THREE.TorusGeometry(
      0.42,
      0.013,
      6,
      SEG(14, 10),
      Math.PI,
    );
    const rearSway = new THREE.Mesh(rearSwayGeo, materials.swayBar);
    rearSway.rotation.x = -Math.PI / 2;
    rearSway.position.set(0, 0.01, 0.16);
    if (rearSubframeMeshGroup) rearSubframeMeshGroup.add(rearSway);
  }
  bootProgress(55, "Подвеска: Макферсон и многорычажка");
  await nextFrame();
  buildSuspension();

  /* 5. WHEEL HUBS, BRAKE DISCS & WHEELS */
  const wheelAssemblies = [];

  function buildWheelsAndBrakes() {
    suspensionCorners.forEach((sc, idx) => {
      const wheelGroup = new THREE.Group();
      wheelGroup.position.set(sc.cfg.x, 0.32, sc.cfg.z);
      wheelsGroup.add(wheelGroup);

      const sign = sc.cfg.isLeft ? -1 : 1;

      const hubAndDiscGroup = new THREE.Group();
      wheelGroup.add(hubAndDiscGroup);

      const hubFlangeGeo = new THREE.CylinderGeometry(
        0.082,
        0.082,
        0.032,
        SEG(40, 24),
      );
      const hubMesh = new THREE.Mesh(hubFlangeGeo, materials.hubWheelBearing);
      hubMesh.rotation.z = Math.PI / 2;
      hubMesh.castShadow = true;
      hubAndDiscGroup.add(hubMesh);

      /* Обойма ступичного подшипника и тормозной щит */
      const bearingRace = new THREE.Mesh(
        new THREE.CylinderGeometry(0.056, 0.056, 0.052, 32),
        materials.ballJointSteel,
      );
      bearingRace.rotation.z = Math.PI / 2;
      bearingRace.position.x = -sign * 0.022;
      hubAndDiscGroup.add(bearingRace);

      const dustShield = new THREE.Mesh(
        new THREE.CylinderGeometry(0.158, 0.158, 0.003, SEG(40, 24)),
        materials.frame,
      );
      dustShield.rotation.z = Math.PI / 2;
      dustShield.position.x = -sign * 0.036;
      dustShield.receiveShadow = true;
      hubAndDiscGroup.add(dustShield);

      const lugNutMeshes = [];
      for (let s = 0; s < 5; s++) {
        const la = (s / 5) * Math.PI * 2;
        const stud = createHexBoltMesh(0.008, 0.05);
        stud.rotation.y = (sign * Math.PI) / 2;
        stud.position.set(
          sign * 0.022,
          Math.sin(la) * 0.056,
          Math.cos(la) * 0.056,
        );
        hubAndDiscGroup.add(stud);
        lugNutMeshes.push(stud);
      }

      /* Вентилируемый диск 340×30 мм */
      const discGeo = new THREE.CylinderGeometry(0.17, 0.17, 0.03, SEG(64, 36));
      const discMat = materials.brakeDisc.clone();
      discMat.emissive = new THREE.Color(0x000000);
      discMat.emissiveIntensity = 0;
      const discMesh = new THREE.Mesh(discGeo, discMat);
      discMesh.rotation.z = Math.PI / 2;
      discMesh.castShadow = true;
      discMesh.receiveShadow = true;
      hubAndDiscGroup.add(discMesh);

      /* Тёмный поясок вентиляционного зазора между рабочими поверхностями */
      const ventEdge = new THREE.Mesh(
        new THREE.CylinderGeometry(
          0.1706,
          0.1706,
          0.0095,
          SEG(64, 36),
          1,
          true,
        ),
        materials.rimInner,
      );
      ventEdge.rotation.z = Math.PI / 2;
      hubAndDiscGroup.add(ventEdge);

      /* Ступичная шляпка диска */
      const discHat = new THREE.Mesh(
        new THREE.CylinderGeometry(0.072, 0.072, 0.046, 32),
        materials.hubWheelBearing,
      );
      discHat.rotation.z = Math.PI / 2;
      discHat.position.x = sign * 0.008;
      hubAndDiscGroup.add(discHat);

      const caliperGroup = new THREE.Group();
      caliperGroup.position.set(0, 0.115, -0.088);
      caliperGroup.rotation.x = -0.656;
      wheelGroup.add(caliperGroup);

      /* Суппорт: внутренняя половина, мост через диск, колодки */
      const caliperGeo = new THREE.BoxGeometry(0.036, 0.074, 0.128);
      const caliperMesh = new THREE.Mesh(caliperGeo, materials.brakeCaliper);
      caliperMesh.position.set(-0.032, 0.004, 0);
      caliperMesh.castShadow = true;
      caliperGroup.add(caliperMesh);

      const caliperOuter = new THREE.Mesh(
        new THREE.BoxGeometry(0.028, 0.064, 0.118),
        materials.brakeCaliper,
      );
      caliperOuter.position.set(0.032, 0.002, 0);
      caliperOuter.castShadow = true;
      caliperGroup.add(caliperOuter);

      [0.056, -0.056].forEach((tz) => {
        const bridge = new THREE.Mesh(
          new THREE.BoxGeometry(0.092, 0.028, 0.026),
          materials.brakeCaliper,
        );
        bridge.position.set(0, 0.026, tz);
        bridge.castShadow = true;
        caliperGroup.add(bridge);
      });

      [-0.034, 0.034].forEach((fz) => {
        const fin = new THREE.Mesh(
          new THREE.BoxGeometry(0.04, 0.012, 0.01),
          materials.brakeCaliper,
        );
        fin.position.set(-0.032, 0.044, fz);
        caliperGroup.add(fin);
      });

      [-0.02, 0.02].forEach((px) => {
        const pad = new THREE.Mesh(
          new THREE.BoxGeometry(0.011, 0.046, 0.102),
          materials.brakePad,
        );
        pad.position.set(px, -0.006, 0);
        caliperGroup.add(pad);
      });

      /* Штуцер тормозного шланга */
      const hoseFitting = new THREE.Mesh(
        new THREE.CylinderGeometry(0.008, 0.008, 0.034, 14),
        materials.ballJointSteel,
      );
      hoseFitting.position.set(-0.046, 0.034, 0.05);
      hoseFitting.rotation.z = 0.55;
      caliperGroup.add(hoseFitting);

      const calBolt1 = createHexBoltMesh(0.008, 0.036);
      calBolt1.rotation.y = Math.PI / 2;
      calBolt1.position.set(-0.048, 0, 0.054);
      caliperGroup.add(calBolt1);

      const calBolt2 = createHexBoltMesh(0.008, 0.036);
      calBolt2.rotation.y = Math.PI / 2;
      calBolt2.position.set(-0.048, 0, -0.054);
      caliperGroup.add(calBolt2);

      const rotatingWheelGroup = new THREE.Group();
      wheelGroup.add(rotatingWheelGroup);

      /* Диск колеса 5×112: тёмный обод, полированные закраины, 5 спиц */
      const rimProfile = [
        [0.15, -0.098],
        [0.212, -0.098],
        [0.229, -0.092],
        [0.2255, -0.086],
        [0.216, -0.082],
        [0.216, -0.058],
        [0.184, -0.038],
        [0.184, 0.014],
        [0.216, 0.042],
        [0.216, 0.082],
        [0.2255, 0.086],
        [0.229, 0.092],
        [0.212, 0.098],
        [0.15, 0.098],
      ].map((p) => new THREE.Vector2(p[0], p[1]));

      const rimBarrelGeo = new THREE.LatheGeometry(rimProfile, 56);
      const rimBarrel = new THREE.Mesh(rimBarrelGeo, materials.rim);
      rimBarrel.rotation.z = (-sign * Math.PI) / 2;
      rimBarrel.castShadow = true;
      rotatingWheelGroup.add(rimBarrel);

      const rimBarrelInner = new THREE.Mesh(
        rimBarrelGeo,
        materials.rimInner.clone(),
      );
      rimBarrelInner.material.side = THREE.BackSide;
      rimBarrelInner.rotation.z = (-sign * Math.PI) / 2;
      rotatingWheelGroup.add(rimBarrelInner);

      const spokeGroup = new THREE.Group();
      const faceX = sign * 0.072;

      const rimOuterRing = new THREE.Mesh(
        new THREE.TorusGeometry(0.207, 0.017, 16, 56),
        materials.rim,
      );
      rimOuterRing.rotation.y = Math.PI / 2;
      rimOuterRing.position.x = sign * 0.078;
      rimOuterRing.castShadow = true;
      spokeGroup.add(rimOuterRing);

      const rimHubPlate = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.06, 0.014, 32),
        materials.rim,
      );
      rimHubPlate.rotation.z = Math.PI / 2;
      rimHubPlate.position.x = sign * 0.023;
      spokeGroup.add(rimHubPlate);

      const rimDish = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.06, 0.05, 32, 1, true),
        materials.rim,
      );
      rimDish.rotation.z = (-sign * Math.PI) / 2;
      rimDish.position.x = sign * 0.052;
      spokeGroup.add(rimDish);

      for (let s = 0; s < 5; s++) {
        const angle = (s / 5) * Math.PI * 2;
        const spokeGeo = new THREE.CylinderGeometry(0.021, 0.036, 0.176, 4, 1);
        spokeGeo.rotateY(Math.PI / 4);
        const spoke = new THREE.Mesh(spokeGeo, materials.rim);
        spoke.scale.set(0.6, 1, 1);
        spoke.position.set(
          faceX,
          Math.sin(angle) * 0.126,
          Math.cos(angle) * 0.126,
        );
        spoke.rotation.x = Math.PI / 2 - angle;
        spoke.castShadow = true;
        spokeGroup.add(spoke);

        const spokeBack = new THREE.Mesh(
          new THREE.BoxGeometry(0.018, 0.145, 0.028),
          materials.rimInner,
        );
        spokeBack.position.set(
          faceX - sign * 0.026,
          Math.sin(angle) * 0.12,
          Math.cos(angle) * 0.12,
        );
        spokeBack.rotation.x = Math.PI / 2 - angle;
        spokeGroup.add(spokeBack);
      }
      rotatingWheelGroup.add(spokeGroup);

      const centerCapGeo = new THREE.CylinderGeometry(0.05, 0.053, 0.018, 28);
      const centerCap = new THREE.Mesh(centerCapGeo, materials.hubWheelBearing);
      centerCap.rotation.z = (-sign * Math.PI) / 2;
      centerCap.position.x = sign * 0.07;
      rotatingWheelGroup.add(centerCap);

      const centerCapRing = new THREE.Mesh(
        new THREE.TorusGeometry(0.052, 0.006, 10, 26),
        materials.rim,
      );
      centerCapRing.rotation.y = Math.PI / 2;
      centerCapRing.position.x = sign * 0.074;
      rotatingWheelGroup.add(centerCapRing);

      /* Покрышка 225/40 R18 */
      const tireProfile = [
        [0.224, -0.086],
        [0.243, -0.099],
        [0.268, -0.104],
        [0.295, -0.099],
        [0.313, -0.086],
        [0.322, -0.062],
        [0.3255, -0.03],
        [0.326, 0],
        [0.3255, 0.03],
        [0.322, 0.062],
        [0.313, 0.086],
        [0.295, 0.099],
        [0.268, 0.104],
        [0.243, 0.099],
        [0.224, 0.086],
      ].map((p) => new THREE.Vector2(p[0], p[1]));

      const tireGeo = new THREE.LatheGeometry(tireProfile, SEG(72, 44));
      const tire = new THREE.Mesh(tireGeo, materials.tire);
      tire.rotation.z = (-sign * Math.PI) / 2;
      tire.castShadow = true;
      tire.receiveShadow = true;
      rotatingWheelGroup.add(tire);

      wheelAssemblies.push({
        id: idx,
        corner: sc,
        wheelGroup,
        hubAndDiscGroup,
        discMesh,
        caliperGroup,
        caliperMesh,
        rotatingWheelGroup,
        lugNutMeshes,
        wheelFallY: 0,
      });
    });
  }
  bootProgress(72, "Тормоза, ступицы, шины 225/40 R18");
  await nextFrame();
  buildWheelsAndBrakes();

  /* 6. ПРИВОД FWD: ПОПЕРЕЧНАЯ КПП СО ВСТРОЕННЫМ РЕДУКТОРОМ + ПРИВОДНЫЕ ВАЛЫ */
  let gearboxAssembly, diffGroup, diffCrownGear, spiderGroup;
  let leftHalfShaftGroup, rightHalfShaftGroup;

  function buildDrivetrain() {
    /* У PQ35 силовой агрегат стоит поперёк: КПП слева по ходу, главная пара и
     дифференциал — в том же картере, два приводных вала идут на передние ступицы.
     Карданного вала и заднего моста на переднеприводной машине нет. */
    const GEARBOX_Y = 0.25;
    const GEARBOX_Z = -1.4;

    const gearboxGroup = new THREE.Group();
    gearboxGroup.position.set(0, GEARBOX_Y, GEARBOX_Z);
    drivetrainGroup.add(gearboxGroup);

    /* Картер сцепления — стык с двигателем (справа по ходу) */
    const bellHousing = new THREE.Mesh(
      new THREE.CylinderGeometry(0.145, 0.125, 0.12, SEG(20, 12)),
      materials.diffCover,
    );
    bellHousing.rotation.z = Math.PI / 2;
    bellHousing.position.set(0.22, 0.01, 0);
    bellHousing.castShadow = true;
    gearboxGroup.add(bellHousing);

    /* Картер 6-ступенчатой КПП (алюминий) */
    const gearCase = new THREE.Mesh(
      new THREE.CylinderGeometry(0.115, 0.105, 0.3, SEG(18, 11)),
      materials.diffHousing,
    );
    gearCase.rotation.z = Math.PI / 2;
    gearCase.position.set(0.01, 0, 0);
    gearCase.castShadow = true;
    gearboxGroup.add(gearCase);

    /* Рёбра жёсткости картера */
    for (let f = -0.06; f <= 0.14; f += 0.05) {
      const fin = new THREE.Mesh(
        new THREE.BoxGeometry(0.012, 0.15, 0.05),
        materials.diffCover,
      );
      fin.position.set(f, 0.02, 0.1);
      gearboxGroup.add(fin);
    }

    /* Поддон и сливная пробка трансмиссионного масла */
    const oilPan = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.05, 0.15),
      materials.diffCover,
    );
    oilPan.position.set(0.02, -0.11, 0);
    gearboxGroup.add(oilPan);

    const drainPlug = new THREE.Mesh(
      new THREE.CylinderGeometry(0.016, 0.016, 0.022, 6),
      materials.bolt,
    );
    drainPlug.position.set(-0.06, -0.14, 0);
    gearboxGroup.add(drainPlug);

    /* Задняя опора КПП на подрамник (тяга-демпфер) */
    const mountArm = new THREE.Mesh(
      new THREE.BoxGeometry(0.07, 0.035, 0.22),
      materials.consoleBracket,
    );
    mountArm.position.set(-0.14, -0.07, 0.16);
    gearboxGroup.add(mountArm);

    const mountBush = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 0.06, SEG(14, 9)),
      materials.cvBoots,
    );
    mountBush.rotation.x = Math.PI / 2;
    mountBush.position.set(-0.14, -0.07, 0.27);
    gearboxGroup.add(mountBush);

    /* Рабочий цилиндр сцепления */
    const clutchSlave = new THREE.Mesh(
      new THREE.CylinderGeometry(0.026, 0.026, 0.09, SEG(12, 8)),
      materials.damperShaft,
    );
    clutchSlave.rotation.z = Math.PI / 2;
    clutchSlave.position.set(0.24, 0.09, 0.08);
    gearboxGroup.add(clutchSlave);

    /* Выходные фланцы редуктора под внутренние ШРУСы */
    const flangeMeshes = [];
    [-1, 1].forEach((fs) => {
      const flange = new THREE.Mesh(
        new THREE.CylinderGeometry(0.055, 0.055, 0.035, SEG(16, 10)),
        materials.ujoint,
      );
      flange.rotation.z = Math.PI / 2;
      flange.position.set(fs * 0.17, 0, 0);
      gearboxGroup.add(flange);
      flangeMeshes.push(flange);
    });

    gearboxAssembly = {
      gearboxGroup,
      gearCase,
      bellHousing,
      flangeMeshes,
      baseY: GEARBOX_Y,
      baseZ: GEARBOX_Z,
      currentSagY: 0,
    };

    /* ── Передний редуктор: главная пара 3.73 + дифференциал (видно в режиме разреза) ── */
    diffGroup = new THREE.Group();
    diffGroup.position.set(-0.17, GEARBOX_Y, GEARBOX_Z);
    drivetrainGroup.add(diffGroup);

    const diffCaseGeo = new THREE.SphereGeometry(
      0.132,
      SEG(14, 10),
      SEG(14, 8),
    );
    diffCaseGeo.scale(1.0, 1.0, 0.88);
    const diffCase = new THREE.Mesh(diffCaseGeo, materials.diffHousing);
    diffCase.castShadow = true;
    diffGroup.add(diffCase);

    /* Ведущая шестерня вторичного вала КПП */
    const pinion = new THREE.Mesh(
      new THREE.CylinderGeometry(0.042, 0.042, 0.1, SEG(14, 9)),
      materials.diffGears,
    );
    pinion.rotation.z = Math.PI / 2;
    pinion.position.set(0.13, 0.065, 0);
    diffGroup.add(pinion);

    /* Коронная шестерня главной пары: ось вращения поперечная (по X) */
    const crownPivot = new THREE.Group();
    crownPivot.rotation.y = Math.PI / 2;
    diffGroup.add(crownPivot);

    const crownGeo = new THREE.TorusGeometry(
      0.098,
      0.024,
      SEG(10, 7),
      SEG(22, 14),
    );
    diffCrownGear = new THREE.Mesh(crownGeo, materials.diffGears);
    crownPivot.add(diffCrownGear);

    /* Полуосевые шестерни и сателлиты внутри коробки дифференциала */
    spiderGroup = new THREE.Group();
    diffCrownGear.add(spiderGroup);
    [-0.055, 0.055].forEach((sz) => {
      const sp = new THREE.Mesh(
        new THREE.ConeGeometry(0.032, 0.045, SEG(10, 7)),
        materials.diffGears,
      );
      sp.position.set(0, 0, sz);
      sp.rotation.x = sz > 0 ? Math.PI / 2 : -Math.PI / 2;
      spiderGroup.add(sp);
    });

    function createHalfShaftAssembly(isLeft) {
      const pivotGroup = new THREE.Group();
      drivetrainGroup.add(pivotGroup);

      const rotatingShaftGroup = new THREE.Group();
      pivotGroup.add(rotatingShaftGroup);

      /* Внутренний ШРУС — трипоидный, допускает осевое перемещение вала */
      const innerJoint = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.05, 0.07, SEG(14, 9)),
        materials.ujoint,
      );
      innerJoint.position.y = 0.035;
      rotatingShaftGroup.add(innerJoint);

      const innerBoot = new THREE.Mesh(
        new THREE.CylinderGeometry(0.048, 0.034, 0.075, SEG(12, 8)),
        materials.cvBoots,
      );
      innerBoot.position.y = 0.105;
      rotatingShaftGroup.add(innerBoot);

      const shaftGeo = new THREE.CylinderGeometry(
        0.022,
        0.022,
        0.5,
        SEG(12, 8),
      );
      const shaftRod = new THREE.Mesh(shaftGeo, materials.halfShaft);
      shaftRod.position.y = 0.28;
      shaftRod.castShadow = true;
      rotatingShaftGroup.add(shaftRod);

      /* Правый вал длиннее и опирается на промежуточный подшипник */
      let supportBearing = null;
      if (!isLeft) {
        supportBearing = new THREE.Mesh(
          new THREE.CylinderGeometry(0.044, 0.044, 0.05, SEG(14, 9)),
          materials.ujoint,
        );
        supportBearing.position.y = 0.3;
        rotatingShaftGroup.add(supportBearing);
      }

      const outerBootGeo = new THREE.CylinderGeometry(
        0.034,
        0.05,
        0.09,
        SEG(12, 8),
      );
      const outerBoot = new THREE.Mesh(outerBootGeo, materials.cvBoots);
      outerBoot.position.y = 0.47;
      rotatingShaftGroup.add(outerBoot);

      /* Наружный шариковый ШРУС в ступице + ступичный болт M16 */
      const outerJoint = new THREE.Mesh(
        new THREE.SphereGeometry(0.048, SEG(14, 9), SEG(10, 7)),
        materials.ujoint,
      );
      outerJoint.position.y = 0.53;
      rotatingShaftGroup.add(outerJoint);

      const axleNutGeo = new THREE.CylinderGeometry(0.026, 0.026, 0.02, 6);
      const axleNut = new THREE.Mesh(axleNutGeo, materials.bolt);
      axleNut.position.y = 0.58;
      rotatingShaftGroup.add(axleNut);

      return {
        pivotGroup,
        rotatingShaftGroup,
        shaftRod,
        innerJoint,
        innerBoot,
        outerBoot,
        outerJoint,
        axleNut,
        supportBearing,
        isLeft,
        rotationAngle: 0,
      };
    }

    leftHalfShaftGroup = createHalfShaftAssembly(true);
    rightHalfShaftGroup = createHalfShaftAssembly(false);
  }
  bootProgress(85, "КПП, редуктор и приводные валы");
  await nextFrame();
  buildDrivetrain();

  /* 7. 4-POST RIG TEST PLATFORMS */
  const rigPads = [];

  function build4PostRig() {
    suspensionCorners.forEach((sc, idx) => {
      const rigGroup = new THREE.Group();
      rigGroup.position.set(sc.cfg.x, 0, sc.cfg.z);
      rigPlatformsGroup.add(rigGroup);

      const padGeo = new THREE.BoxGeometry(0.42, 0.04, 0.75);
      const pad = new THREE.Mesh(padGeo, materials.rigPlatform);
      pad.position.y = 0.02;
      pad.receiveShadow = true;
      rigGroup.add(pad);

      const ramGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.4, 12);
      const ram = new THREE.Mesh(ramGeo, materials.rigPiston);
      ram.position.y = -0.2;
      rigGroup.add(ram);

      rigPads.push({ id: idx, rigGroup, pad, ram });
    });
  }
  bootProgress(92, "Вибростенд 4x");
  await nextFrame();
  build4PostRig();

  return {
    assemblyState,
    frontSubframeMeshGroup,
    rearSubframeMeshGroup,
    frontSwayAssembly,
    steeringRackBar,
    leftTieRodAssembly,
    rightTieRodAssembly,
    steeringColumnShaft,
    steeringRackBoots,
    suspensionCorners,
    wheelAssemblies,
    gearboxAssembly,
    diffGroup,
    diffCrownGear,
    spiderGroup,
    leftHalfShaftGroup,
    rightHalfShaftGroup,
    rigPads,
    aimRod,
    aimGroup,
    P,
  };
}
