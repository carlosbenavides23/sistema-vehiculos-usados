"""Contratos locales del repositorio de roles; no prueban Supabase Auth."""
import unittest
from unittest.mock import MagicMock, patch
from uuid import uuid4

import roles_usuarios


class RolesUsuariosTest(unittest.TestCase):
    def test_asignacion_utiliza_insert_sin_reemplazar_rol(self):
        conexion = MagicMock()
        cursor = conexion.__enter__.return_value.cursor.return_value.__enter__.return_value
        cursor.fetchone.side_effect = [{"rol": "comprador"}, None]
        usuario = uuid4()
        with patch.object(roles_usuarios, "_conectar", return_value=conexion):
            self.assertEqual(roles_usuarios.asignar_rol_inicial(usuario, "comprador"), "comprador")
            self.assertIsNone(roles_usuarios.asignar_rol_inicial(usuario, "vendedor"))
        self.assertIn("ON CONFLICT (usuario_id) DO NOTHING", cursor.execute.call_args.args[0])

    def test_rechaza_rol_e_identidad_invalidos_antes_de_conectar(self):
        with patch.object(roles_usuarios, "_conectar") as conectar:
            with self.assertRaises(ValueError):
                roles_usuarios.asignar_rol_inicial(uuid4(), "admin")
            with self.assertRaises(ValueError):
                roles_usuarios.obtener_rol("no-es-uuid")
        conectar.assert_not_called()
