import {
  FileText,
  ClipboardCheck,
  ReceiptIndianRupee,
  Wallet,
} from "lucide-react";

import StatCard from "@/components/ui/StatCard";

const cards = [
  {
    title: "Total LRs",
    value: "0",
    icon: FileText,
  },
  {
    title: "Pending POD",
    value: "0",
    icon: ClipboardCheck,
  },
  {
    title: "Pending Billing",
    value: "₹0",
    icon: ReceiptIndianRupee,
  },
  {
    title: "Outstanding",
    value: "₹0",
    icon: Wallet,
  },
];

export default function DashboardCards() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <StatCard
          key={card.title}
          title={card.title}
          value={card.value}
          icon={card.icon}
        />
      ))}
    </div>
  );
}
