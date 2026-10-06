// Surface-to-air missile fired by SAM sites and warships (radar-guided).
export default {
  id: 'samMissile', name: 'SAM', slot: 'secondary', class: 'MissileWeapon', hidden: true, category: 'surface-to-air',
  seeker: 'radar', guidance: 'radar', damage: 40, splash: 16, proximity: 12, speed: 900, accel: 300, burn: 5, life: 16,
  turnRate: 1.6, gimbal: 0.1, decoyResist: 0.15, lead: 1, model: 'missileBig', motorDelay: 0.25, trailScale: 1.5, glow: 3.5,
};
