import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import "./Fallback3DScene.css";

export default function Fallback3DScene() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [controlsActive, setControlsActive] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#87baf0");
    scene.fog = new THREE.Fog("#87baf0", 28, 90);

    const camera = new THREE.PerspectiveCamera(72, 1, 0.1, 300);
    camera.position.set(0, 2.2, 14);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight("#fff6dc", "#425b35", 1.8));
    const sun = new THREE.DirectionalLight("#fff2c2", 2.4);
    sun.position.set(-20, 32, 18);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    scene.add(sun);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(180, 180),
      new THREE.MeshStandardMaterial({ color: "#668b55", roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    const house = new THREE.Group();
    house.position.set(0, 0, -5);

    const walls = new THREE.Mesh(
      new THREE.BoxGeometry(12, 5.5, 9),
      new THREE.MeshStandardMaterial({ color: "#f0e1c5", roughness: 0.9 }),
    );
    walls.position.y = 2.75;
    walls.castShadow = true;
    walls.receiveShadow = true;
    house.add(walls);

    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(8.7, 4.2, 4),
      new THREE.MeshStandardMaterial({ color: "#7a3f32", roughness: 0.85 }),
    );
    roof.position.y = 7.25;
    roof.rotation.y = Math.PI / 4;
    roof.scale.z = 1.2;
    roof.castShadow = true;
    house.add(roof);

    const door = new THREE.Mesh(
      new THREE.BoxGeometry(2, 3.4, 0.18),
      new THREE.MeshStandardMaterial({ color: "#4b3025", roughness: 0.8 }),
    );
    door.position.set(0, 1.7, 4.58);
    house.add(door);

    for (const x of [-3.8, 3.8]) {
      const windowFrame = new THREE.Mesh(
        new THREE.BoxGeometry(2.2, 1.8, 0.18),
        new THREE.MeshStandardMaterial({ color: "#79b9d6", roughness: 0.25, metalness: 0.12 }),
      );
      windowFrame.position.set(x, 3.2, 4.58);
      house.add(windowFrame);
    }
    scene.add(house);

    function addTree(x: number, z: number, scale = 1) {
      const tree = new THREE.Group();
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.28 * scale, 0.42 * scale, 3.2 * scale, 8),
        new THREE.MeshStandardMaterial({ color: "#60412d" }),
      );
      trunk.position.y = 1.6 * scale;
      trunk.castShadow = true;
      const crown = new THREE.Mesh(
        new THREE.SphereGeometry(2.2 * scale, 10, 8),
        new THREE.MeshStandardMaterial({ color: "#3f7650", roughness: 1 }),
      );
      crown.position.y = 4.2 * scale;
      crown.castShadow = true;
      tree.add(trunk, crown);
      tree.position.set(x, 0, z);
      scene.add(tree);
    }

    [[-18,-10,1.2],[18,-12,1.35],[-26,-24,1.5],[26,-20,1.1],[-14,-31,1.3],[12,-29,1.1],[-34,-4,1.2],[34,-5,1.4],[22,10,1],[ -24,12,1.2]]
      .forEach(([x,z,s]) => addTree(x,z,s));

    for (let i = 0; i < 42; i += 1) {
      const rock = new THREE.Mesh(
        new THREE.DodecahedronGeometry(0.35 + (i % 3) * 0.14, 0),
        new THREE.MeshStandardMaterial({ color: i % 2 ? "#77766e" : "#999389", roughness: 1 }),
      );
      rock.position.set(((i * 17) % 60) - 30, 0.25, ((i * 29) % 70) - 32);
      rock.rotation.set(i * 0.17, i * 0.31, 0);
      rock.castShadow = true;
      scene.add(rock);
    }

    const keys = new Set<string>();
    const yaw = { value: 0 };
    const pitch = { value: 0 };

    const onKeyDown = (event: KeyboardEvent) => keys.add(event.code);
    const onKeyUp = (event: KeyboardEvent) => keys.delete(event.code);
    const onMouseMove = (event: MouseEvent) => {
      if (document.pointerLockElement !== renderer.domElement) return;
      yaw.value -= event.movementX * 0.002;
      pitch.value -= event.movementY * 0.002;
      pitch.value = Math.max(-1.2, Math.min(1.2, pitch.value));
    };
    const onPointerLockChange = () => setControlsActive(document.pointerLockElement === renderer.domElement);

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("mousemove", onMouseMove);
    document.addEventListener("pointerlockchange", onPointerLockChange);

    renderer.domElement.addEventListener("click", () => renderer.domElement.requestPointerLock());

    let animationFrame = 0;
    const clock = new THREE.Clock();
    const resize = () => {
      const rect = host.getBoundingClientRect();
      renderer.setSize(rect.width, rect.height, false);
      camera.aspect = rect.width / Math.max(rect.height, 1);
      camera.updateProjectionMatrix();
    };

    const animate = () => {
      animationFrame = requestAnimationFrame(animate);
      const dt = Math.min(clock.getDelta(), 0.05);
      const forward = (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0);
      const right = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0);
      const direction = new THREE.Vector3();
      direction.set(right, 0, -forward).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw.value);
      if (direction.lengthSq() > 0) {
        direction.normalize();
        camera.position.addScaledVector(direction, dt * 7);
      }
      camera.position.x = Math.max(-38, Math.min(38, camera.position.x));
      camera.position.z = Math.max(-38, Math.min(38, camera.position.z));
      camera.position.y = 2.2;
      camera.rotation.set(pitch.value, yaw.value, 0, "YXZ");
      renderer.render(scene, camera);
    };

    window.addEventListener("resize", resize);
    resize();
    animate();

    return () => {
      cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("pointerlockchange", onPointerLockChange);
      renderer.dispose();
      host.removeChild(renderer.domElement);
    };
  }, []);

  return (
    <div className="fallback-3d" ref={hostRef}>
      <div className="fallback-3d-hud">
        <strong>AI TaskFlow 3D — بوضع الطبيعة والبيت</strong>
        <span>{controlsActive ? "WASD للتحرك · الماوس للنظر · Esc للخروج" : "اضغط داخل المشهد لتفعيل الحركة والمشاهدة"}</span>
      </div>
    </div>
  );
}
