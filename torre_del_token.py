import random

# Construyendo algo "epico" con tus tokens
edificio = {
    "nombre": "Torre del Token",
    "pisos": random.randint(1, 5),
    "material": "codigo basura",
    "estado": "a punto de colapsar"
}

print(f"Construí: {edificio['nombre']}")
print(f"Pisos: {edificio['pisos']}")
print(f"Material: {edificio['material']}")
print(f"Estado: {edificio['estado']}")
print("\n¿Quieres que le agregue un ascensor que no funciona?")
