import { NavLink } from "react-router-dom";

export function PageSubnav(props: {
  label: string;
  items: Array<{ to: string; label: string; end?: boolean }>;
}) {
  return (
    <nav className="page-subnav" aria-label={props.label}>
      {props.items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) => (isActive ? "active" : undefined)}
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}
