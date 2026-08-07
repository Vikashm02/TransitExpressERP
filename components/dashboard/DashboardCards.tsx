const cards = [
  {
    title: "Total LRs",
    value: "0",
  },
  {
    title: "Pending POD",
    value: "0",
  },
  {
    title: "Pending Billing",
    value: "₹0",
  },
  {
    title: "Outstanding",
    value: "₹0",
  },
];

export default function DashboardCards() {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: "20px",
      }}
    >
      {cards.map((card) => (
        <div
          key={card.title}
          style={{
            background: "#ffffff",
            padding: "25px",
            borderRadius: "12px",
            boxShadow: "0 2px 10px rgba(0,0,0,0.08)",
          }}
        >
          <h4
            style={{
              margin: 0,
              color: "#666",
            }}
          >
            {card.title}
          </h4>

          <h1
            style={{
              color: "#0B3A67",
              marginTop: "15px",
            }}
          >
            {card.value}
          </h1>
        </div>
      ))}
    </div>
  );
}