# Adapters are written per data standard, not per Source

Pulse aims to cover any region. Most transit, road and weather publishers worldwide use GTFS-RT, DATEX II (or WZDx) and CAP. So we write one Adapter per standard and configure it per Source. Custom Adapters are only for non-standard Sources such as Helsinki's land-use permit WFS. The public API exposes Pulse's own simple Event JSON, not any of the standards.
