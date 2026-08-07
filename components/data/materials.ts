export interface MaterialData {
  id: number;

  material: string;

  packageType: string;
}

export const materials: MaterialData[] = [
  {
    id: 1,
    material: "TMT Bars",
    packageType: "Bundle",
  },
  {
    id: 2,
    material: "Cement",
    packageType: "Bag",
  },
  {
    id: 3,
    material: "Steel Coil",
    packageType: "Coil",
  },
];