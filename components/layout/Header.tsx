export default function Header() {
  return (
    <header
      style={{
        height: "70px",
        backgroundColor: "#ffffff",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 25px",
        borderBottom: "1px solid #e5e7eb",
      }}
    >
      <div>
        <h2
          style={{
            margin: 0,
            color: "#0B3A67",
          }}
        >
          Transjit Express TMS
        </h2>
      </div>

      <div
        style={{
          fontWeight: "bold",
          color: "#0B3A67",
        }}
      >
        Admin
      </div>
    </header>
  );
}